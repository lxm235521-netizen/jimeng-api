import path from 'path';
import fs from 'fs-extra';
import _ from 'lodash';

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

import util from '@/lib/util.ts';
import { parseRegionFromToken, type RegionInfo } from '@/api/controllers/core.ts';

export type TokenStatus = 'valid' | 'invalid';
export type TokenNode = 'cn' | 'us' | 'jp' | 'hk' | 'sg';

export interface TokenRecord {
  id: string;
  token_value: string;
  status: TokenStatus;
  node: TokenNode;
  updated_at: string;
  created_at: string;
  // 最近一次查询到的积分快照（可选）
  credit_total?: number;
  credit_gift?: number;
  credit_purchase?: number;
  credit_vip?: number;
  credit_updated_at?: string;
}

interface TokenDBSchema {
  tokens: TokenRecord[];
  meta: {
    rrCursor: number;
    rrCursorByNode: Record<string, number>;
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
  const db = new Low<TokenDBSchema>(adapter, {
    tokens: [],
    meta: { rrCursor: 0, rrCursorByNode: {} },
  });
  await db.read();
  db.data ||= { tokens: [], meta: { rrCursor: 0, rrCursorByNode: {} } };
  db.data.tokens ||= [];
  db.data.meta ||= { rrCursor: 0, rrCursorByNode: {} };
  db.data.meta.rrCursorByNode ||= {};
  if (!_.isFinite(db.data.meta.rrCursor as any)) db.data.meta.rrCursor = 0;
  return db;
}

function normalizeTokenValue(raw: string): string {
  let v = (raw || '').trim();
  if (!v) return '';
  if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, '').trim();
  return v;
}

function nodeFromTokenValue(tokenValue: string): TokenNode {
  // token 自带地区前缀：us-/jp-/hk-/sg-；否则视为国内 cn
  const info: RegionInfo = parseRegionFromToken(tokenValue);
  if (info.isUS) return 'us';
  if (info.isJP) return 'jp';
  if (info.isHK) return 'hk';
  if (info.isSG) return 'sg';
  return 'cn';
}

export async function listTokens(filter?: { node?: TokenNode; status?: TokenStatus }): Promise<TokenRecord[]> {
  return withLock(async () => {
    const db = await getDB();
    let items = db.data!.tokens;
    if (filter?.node) items = items.filter((t) => t.node === filter.node);
    if (filter?.status) items = items.filter((t) => t.status === filter.status);
    return _.orderBy(items, ['updated_at', 'created_at'], ['desc', 'desc']);
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
      existed.node = nodeFromTokenValue(token_value);
      existed.updated_at = new Date().toISOString();
      await db.write();
      return existed;
    }

    const now = new Date().toISOString();
    const rec: TokenRecord = {
      id: util.uuid(),
      token_value,
      status: 'valid',
      node: nodeFromTokenValue(token_value),
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
          existed.node = nodeFromTokenValue(token_value);
          existed.updated_at = new Date().toISOString();
          skipped++;
          continue;
        }

        const now = new Date().toISOString();
        db.data!.tokens.push({
          id: util.uuid(),
          token_value,
          status: 'valid',
          node: nodeFromTokenValue(token_value),
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

export async function updateTokenCreditByValue(
  tokenValue: string,
  credit: { total: number; gift: number; purchase: number; vip: number }
): Promise<boolean> {
  return withLock(async () => {
    const db = await getDB();
    const token_value = normalizeTokenValue(tokenValue);
    const rec = db.data!.tokens.find((t) => t.token_value === token_value);
    if (!rec) return false;
    rec.credit_total = Number(credit.total);
    rec.credit_gift = Number(credit.gift);
    rec.credit_purchase = Number(credit.purchase);
    rec.credit_vip = Number(credit.vip);
    rec.credit_updated_at = new Date().toISOString();
    rec.updated_at = new Date().toISOString();
    await db.write();
    return true;
  });
}

export async function resetAllTokenStatus(status: TokenStatus = 'valid'): Promise<number> {
  return withLock(async () => {
    const db = await getDB();
    const now = new Date().toISOString();
    let changed = 0;
    for (const t of db.data!.tokens) {
      if (t.status !== status) {
        t.status = status;
        t.updated_at = now;
        changed++;
      }
    }
    if (changed > 0) await db.write();
    return changed;
  });
}

export async function resetTokenStatusByFilter(
  filter: { node?: TokenNode },
  status: TokenStatus = 'valid'
): Promise<number> {
  return withLock(async () => {
    const db = await getDB();
    const now = new Date().toISOString();
    let changed = 0;
    for (const t of db.data!.tokens) {
      if (filter?.node && t.node !== filter.node) continue;
      if (t.status !== status) {
        t.status = status;
        t.updated_at = now;
        changed++;
      }
    }
    if (changed > 0) await db.write();
    return changed;
  });
}

export async function pickValidToken(
  strategy: 'random' | 'roundrobin' = 'roundrobin',
  options?: { node?: TokenNode }
): Promise<TokenRecord | null> {
  return withLock(async () => {
    const db = await getDB();

    // 仅从可用 token 中选择（status=valid 表示可用；status=invalid 表示因积分不足等原因暂不可用）
    let candidates = db.data!.tokens.filter((t) => t.status === 'valid');
    if (options?.node) candidates = candidates.filter((t) => t.node === options.node);

    if (candidates.length === 0) return null;

    // 如果已缓存过积分信息，优先从“已知有积分”的 token 中挑选，避免频繁命中无积分 token
    const withCredit = candidates.filter((t) => _.isFinite(t.credit_total as any) && Number(t.credit_total) > 0);
    if (withCredit.length > 0) {
      candidates = withCredit;
    }

    if (strategy === 'random') {
      return _.sample(candidates) as TokenRecord;
    }

    // round-robin (per node or global)
    if (options?.node) {
      const key = options.node;
      const cursor = Number(db.data!.meta.rrCursorByNode[key] || 0);
      const idx = ((cursor % candidates.length) + candidates.length) % candidates.length;
      const picked = candidates[idx];
      db.data!.meta.rrCursorByNode[key] = idx + 1;
      await db.write();
      return picked;
    }

    const cursor = Number(db.data!.meta.rrCursor || 0);
    const idx = ((cursor % candidates.length) + candidates.length) % candidates.length;
    const picked = candidates[idx];
    db.data!.meta.rrCursor = idx + 1;
    await db.write();
    return picked;
  });
}
