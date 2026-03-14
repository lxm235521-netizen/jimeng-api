import fs from 'fs-extra';
import path from 'path';
import _ from 'lodash';

import util from '@/lib/util.ts';

export type TokenStatus = 'valid' | 'invalid';

export interface TokenRecord {
  id: string;
  token_value: string;
  status: TokenStatus;
  updated_at: string;
  created_at: string;
}

interface TokenDB {
  tokens: TokenRecord[];
  meta: {
    rrCursor: number;
  };
}

const DATA_DIR = path.join(path.resolve(), 'data');
const DB_PATH = path.join(DATA_DIR, 'tokens.json');

let lock: Promise<any> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  // keep chain alive even if it fails
  lock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function ensureDBFile() {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(DB_PATH))) {
    const init: TokenDB = { tokens: [], meta: { rrCursor: 0 } };
    await fs.writeJson(DB_PATH, init, { spaces: 2 });
  }
}

async function loadDB(): Promise<TokenDB> {
  await ensureDBFile();
  const db = (await fs.readJson(DB_PATH)) as Partial<TokenDB>;
  return {
    tokens: Array.isArray(db.tokens) ? (db.tokens as TokenRecord[]) : [],
    meta: {
      rrCursor: Number((db.meta as any)?.rrCursor || 0),
    },
  };
}

async function saveDB(db: TokenDB) {
  await fs.writeJson(DB_PATH, db, { spaces: 2 });
}

function normalizeTokenValue(raw: string): string {
  let v = (raw || '').trim();
  if (!v) return '';
  if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, '').trim();
  return v;
}

export async function listTokens(): Promise<TokenRecord[]> {
  return withLock(async () => {
    const db = await loadDB();
    // 最新更新时间优先
    return _.orderBy(db.tokens, ['updated_at', 'created_at'], ['desc', 'desc']);
  });
}

export async function addToken(tokenValue: string): Promise<TokenRecord> {
  return withLock(async () => {
    const db = await loadDB();
    const token_value = normalizeTokenValue(tokenValue);
    if (!token_value) throw new Error('token_value 不能为空');

    const existed = db.tokens.find((t) => t.token_value === token_value);
    if (existed) {
      // 已存在：仅更新状态/时间（保持幂等）
      existed.status = 'valid';
      existed.updated_at = new Date().toISOString();
      await saveDB(db);
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
    db.tokens.push(rec);
    await saveDB(db);
    return rec;
  });
}

export async function importTokens(multilineText: string): Promise<{ inserted: number; skipped: number; total: number }>{
  return withLock(async () => {
    const db = await loadDB();

    const lines = (multilineText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let inserted = 0;
    let skipped = 0;

    for (const line of lines) {
      // 支持一行里带逗号的多 token（兼容用户粘贴 Bearer a,b,c）
      const parts = line.split(',').map((x) => x.trim()).filter(Boolean);
      for (const p of parts) {
        const token_value = normalizeTokenValue(p);
        if (!token_value) {
          skipped++;
          continue;
        }
        const existed = db.tokens.find((t) => t.token_value === token_value);
        if (existed) {
          // 认为重新导入即“恢复有效”
          existed.status = 'valid';
          existed.updated_at = new Date().toISOString();
          skipped++;
          continue;
        }
        const now = new Date().toISOString();
        db.tokens.push({
          id: util.uuid(),
          token_value,
          status: 'valid',
          created_at: now,
          updated_at: now,
        });
        inserted++;
      }
    }

    await saveDB(db);
    return { inserted, skipped, total: lines.length };
  });
}

export async function deleteToken(id: string): Promise<boolean> {
  return withLock(async () => {
    const db = await loadDB();
    const before = db.tokens.length;
    db.tokens = db.tokens.filter((t) => t.id !== id);
    const changed = db.tokens.length !== before;
    if (changed) await saveDB(db);
    return changed;
  });
}

export async function markTokenStatusByValue(tokenValue: string, status: TokenStatus): Promise<boolean> {
  return withLock(async () => {
    const db = await loadDB();
    const token_value = normalizeTokenValue(tokenValue);
    const rec = db.tokens.find((t) => t.token_value === token_value);
    if (!rec) return false;
    rec.status = status;
    rec.updated_at = new Date().toISOString();
    await saveDB(db);
    return true;
  });
}

export async function pickValidToken(strategy: 'random' | 'roundrobin' = 'roundrobin'): Promise<TokenRecord | null> {
  return withLock(async () => {
    const db = await loadDB();
    const valids = db.tokens.filter((t) => t.status === 'valid');
    if (valids.length === 0) return null;

    let picked: TokenRecord;
    if (strategy === 'random') {
      picked = _.sample(valids) as TokenRecord;
    } else {
      const idx = ((db.meta.rrCursor || 0) % valids.length + valids.length) % valids.length;
      picked = valids[idx];
      db.meta.rrCursor = idx + 1;
      await saveDB(db);
    }
    return picked;
  });
}
