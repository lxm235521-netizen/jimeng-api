import path from 'path';
import fs from 'fs-extra';
import _ from 'lodash';

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

import util from '@/lib/util.ts';

export type TokenStatus = 'valid' | 'invalid';

export interface TokenRecord {
  id: string;
  token_value: string;
  status: TokenStatus;
  updated_at: string;
  created_at: string;
}

interface TokenDBSchema {
  tokens: TokenRecord[];
  meta: {
    rrCursor: number;
  };
}

const DATA_DIR = path.join(path.resolve(), 'data');
const DB_PATH = path.join(DATA_DIR, 'tokens.json');

// Serialize all lowdb operations to avoid write races
let lock: Promise<any> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function getDB(): Promise<Low<TokenDBSchema>> {
  await fs.ensureDir(DATA_DIR);
  const adapter = new JSONFile<TokenDBSchema>(DB_PATH);
  const db = new Low<TokenDBSchema>(adapter, { tokens: [], meta: { rrCursor: 0 } });
  await db.read();
  // lowdb might return null on first read
  db.data ||= { tokens: [], meta: { rrCursor: 0 } };
  db.data.tokens ||= [];
  db.data.meta ||= { rrCursor: 0 };
  if (!_.isFinite(db.data.meta.rrCursor as any)) db.data.meta.rrCursor = 0;
  return db;
}

function normalizeTokenValue(raw: string): string {
  let v = (raw || '').trim();
  if (!v) return '';
  if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, '').trim();
  return v;
}

export async function listTokens(): Promise<TokenRecord[]> {
  return withLock(async () => {
    const db = await getDB();
    const tokens = db.data!.tokens;
    return _.orderBy(tokens, ['updated_at', 'created_at'], ['desc', 'desc']);
  });
}

export async function addToken(tokenValue: string): Promise<TokenRecord> {
  return withLock(async () => {
    const db = await getDB();
    const token_value = normalizeTokenValue(tokenValue);
    if (!token_value) throw new Error('token_value 不能为空');

    const existed = db.data!.tokens.find((t) => t.token_value === token_value);
    if (existed) {
      existed.status = 'valid';
      existed.updated_at = new Date().toISOString();
      await db.write();
      return existed;
    }

    const now = new Date().toISOString();
    const rec: TokenRecord = {
      id: util.uuid(),
      token_value,
      status: 'valid',
      created_at: now,
      updated_at: now,
    };

    db.data!.tokens.push(rec);
    await db.write();
    return rec;
  });
}

export async function importTokens(multilineText: string): Promise<{ inserted: number; skipped: number; totalLines: number; totalTokens: number }> {
  return withLock(async () => {
    const db = await getDB();

    const lines = (multilineText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let inserted = 0;
    let skipped = 0;
    let totalTokens = 0;

    for (const line of lines) {
      // 支持一行里带逗号的多 token（兼容用户粘贴 Bearer a,b,c）
      const parts = line.split(',').map((x) => x.trim()).filter(Boolean);
      for (const p of parts) {
        totalTokens++;
        const token_value = normalizeTokenValue(p);
        if (!token_value) {
          skipped++;
          continue;
        }

        const existed = db.data!.tokens.find((t) => t.token_value === token_value);
        if (existed) {
          existed.status = 'valid';
          existed.updated_at = new Date().toISOString();
          skipped++;
          continue;
        }

        const now = new Date().toISOString();
        db.data!.tokens.push({
          id: util.uuid(),
          token_value,
          status: 'valid',
          created_at: now,
          updated_at: now,
        });
        inserted++;
      }
    }

    await db.write();
    return { inserted, skipped, totalLines: lines.length, totalTokens };
  });
}

export async function deleteToken(id: string): Promise<boolean> {
  return withLock(async () => {
    const db = await getDB();
    const before = db.data!.tokens.length;
    db.data!.tokens = db.data!.tokens.filter((t) => t.id !== id);
    const changed = db.data!.tokens.length !== before;
    if (changed) await db.write();
    return changed;
  });
}

export async function markTokenStatusByValue(tokenValue: string, status: TokenStatus): Promise<boolean> {
  return withLock(async () => {
    const db = await getDB();
    const token_value = normalizeTokenValue(tokenValue);
    const rec = db.data!.tokens.find((t) => t.token_value === token_value);
    if (!rec) return false;
    rec.status = status;
    rec.updated_at = new Date().toISOString();
    await db.write();
    return true;
  });
}

export async function pickValidToken(strategy: 'random' | 'roundrobin' = 'roundrobin'): Promise<TokenRecord | null> {
  return withLock(async () => {
    const db = await getDB();
    const valids = db.data!.tokens.filter((t) => t.status === 'valid');
    if (valids.length === 0) return null;

    let picked: TokenRecord;
    if (strategy === 'random') {
      picked = _.sample(valids) as TokenRecord;
    } else {
      const cursor = Number(db.data!.meta?.rrCursor || 0);
      const idx = ((cursor % valids.length) + valids.length) % valids.length;
      picked = valids[idx];
      db.data!.meta.rrCursor = idx + 1;
      await db.write();
    }

    return picked;
  });
}
