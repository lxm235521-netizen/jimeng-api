import cron from 'node-cron';
import logger from '@/lib/logger.ts';
import { cleanupExpiredTasks } from '@/lib/task-store.ts';

export function startTaskCleanupJob(options?: { schedule?: string }) {
  // 每分钟清一次（任务 TTL 默认 30 分钟）
  const schedule = options?.schedule ?? '*/1 * * * *';
  cron.schedule(
    schedule,
    async () => {
      try {
        const removed = await cleanupExpiredTasks();
        if (removed > 0) logger.info(`[task-cleanup] removed expired tasks: ${removed}`);
      } catch (err: any) {
        logger.error('[task-cleanup] job error:', err);
      }
    },
    { timezone: 'Asia/Shanghai' }
  );
  logger.info(`[task-cleanup] cron scheduled: ${schedule} (Asia/Shanghai)`);
}

