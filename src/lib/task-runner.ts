import logger from '@/lib/logger.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import { createTask, updateTask, type TaskType, type TaskRecord } from '@/lib/task-store.ts';

type Job = { taskId: string; type: TaskType; run: () => Promise<any> };

const queue: Job[] = [];
let running = 0;

export interface TaskRunnerOptions {
  concurrency?: number;
}

const opts: Required<TaskRunnerOptions> = {
  concurrency: 2,
};

export function configureTaskRunner(options: TaskRunnerOptions = {}) {
  if (typeof options.concurrency === 'number' && options.concurrency > 0) {
    opts.concurrency = Math.floor(options.concurrency);
  }
}

function drain() {
  while (running < opts.concurrency && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    (async () => {
      try {
        const result = await job.run();
        await updateTask(job.taskId, { status: 'succeeded', result });
      } catch (err: any) {
        const code = err instanceof APIException ? err.errcode : undefined;
        const message = String(err?.errmsg || err?.message || '任务失败');
        await updateTask(job.taskId, { status: 'failed', error: { code, message } });
        logger.error(`[task-runner] task failed: ${job.taskId}`, err);
      } finally {
        running--;
        drain();
      }
    })().catch((e) => {
      running--;
      logger.error('[task-runner] unexpected error:', e);
      drain();
    });
  }
}

export async function submitTask(params: {
  type: TaskType;
  payload: any;
  node?: TaskRecord['node'];
  ttlMs: number;
  run: () => Promise<any>;
}) {
  const task = await createTask({
    type: params.type,
    payload: params.payload,
    node: params.node,
    ttlMs: params.ttlMs,
  });

  queue.push({ taskId: task.id, type: params.type, run: params.run });
  drain();
  return task;
}

