import path from 'path';
import fs from 'fs-extra';
import _ from 'lodash';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

import util from '@/lib/util.ts';

export type TaskType = 'image' | 'video';
export type TaskStatus = 'processing' | 'succeeded' | 'failed';

export interface TaskRecord {
  id: string;
  type: TaskType;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;

  // request context
  node?: 'cn' | 'us' | 'jp' | 'hk' | 'sg';
  // avoid persisting raw sessionid; store the picked token value only if needed for debugging
  // token_value?: string;

  payload: any;

  result?: any;
  error?: { code?: number; message?: string };
}

interface TaskDBSchema {
  tasks: TaskRecord[];
}

const DATA_DIR = path.join(path.resolve(), 'data');
const DB_PATH = path.join(DATA_DIR, 'tasks.json');

let lock: Promise<any> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function getDB(): Promise<Low<TaskDBSchema>> {
  await fs.ensureDir(DATA_DIR);
  const adapter = new JSONFile<TaskDBSchema>(DB_PATH);
  const db = new Low<TaskDBSchema>(adapter, { tasks: [] });
  await db.read();
  db.data ||= { tasks: [] };
  db.data.tasks ||= [];
  return db;
}

function isoInMs(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

export async function createTask(params: {
  type: TaskType;
  payload: any;
  node?: TaskRecord['node'];
  ttlMs: number;
}): Promise<TaskRecord> {
  return withLock(async () => {
    const db = await getDB();
    const now = new Date().toISOString();
    const rec: TaskRecord = {
      id: `task_${util.uuid()}`,
      type: params.type,
      status: 'processing',
      created_at: now,
      updated_at: now,
      expires_at: isoInMs(params.ttlMs),
      node: params.node,
      payload: params.payload,
    };
    db.data!.tasks.push(rec);
    await db.write();
    return rec;
  });
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  return withLock(async () => {
    const db = await getDB();
    return db.data!.tasks.find((t) => t.id === id) || null;
  });
}

export async function updateTask(id: string, patch: Partial<Pick<TaskRecord, 'status' | 'result' | 'error'>>): Promise<boolean> {
  return withLock(async () => {
    const db = await getDB();
    const rec = db.data!.tasks.find((t) => t.id === id);
    if (!rec) return false;
    if (patch.status) rec.status = patch.status;
    if ('result' in patch) rec.result = patch.result;
    if ('error' in patch) rec.error = patch.error;
    rec.updated_at = new Date().toISOString();
    await db.write();
    return true;
  });
}

export async function cleanupExpiredTasks(nowIso: string = new Date().toISOString()): Promise<number> {
  return withLock(async () => {
    const db = await getDB();
    const before = db.data!.tasks.length;
    db.data!.tasks = db.data!.tasks.filter((t) => {
      const exp = t.expires_at;
      return !(_.isString(exp) && exp <= nowIso);
    });
    const removed = before - db.data!.tasks.length;
    if (removed > 0) await db.write();
    return removed;
  });
}

