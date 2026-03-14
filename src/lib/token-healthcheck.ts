import cron from 'node-cron';
import logger from '@/lib/logger.ts';
import { listTokens, markTokenStatusByValue, TokenRecord } from '@/lib/token-store.ts';
import { getTokenLiveStatus } from '@/api/controllers/core.ts';

export interface TokenHealthcheckOptions {
  schedule?: string; // cron expression
  runOnStart?: boolean;
  batchSize?: number;
  delayMs?: number;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkOne(token: TokenRecord): Promise<'valid' | 'invalid'> {
  const live = await getTokenLiveStatus(token.token_value);
  return live ? 'valid' : 'invalid';
}

export async function runTokenHealthcheckOnce(options: TokenHealthcheckOptions = {}) {
  const batchSize = options.batchSize ?? 20;
  const delayMs = options.delayMs ?? 250;

  const tokens = await listTokens();
  const valids = tokens.filter((t) => t.status === 'valid');

  if (valids.length === 0) {
    logger.info('[token-healthcheck] no valid tokens');
    return { total: 0, checked: 0, invalidated: 0 };
  }

  logger.info(`[token-healthcheck] start: valid=${valids.length}`);

  let checked = 0;
  let invalidated = 0;

  for (let i = 0; i < valids.length; i++) {
    const t = valids[i];
    try {
      const status = await checkOne(t);
      checked++;
      if (status === 'invalid') {
        await markTokenStatusByValue(t.token_value, 'invalid');
        invalidated++;
        logger.warn(`[token-healthcheck] invalid token: ${t.id}`);
      }
    } catch (err: any) {
      checked++;
      // 网络/上游波动不直接判死，只记录
      logger.warn(`[token-healthcheck] check failed: ${t.id} ${err?.message || err}`);
    }

    // 轻微节流，避免压上游
    if (delayMs > 0) await sleep(delayMs);

    // 分批间隙（可选）
    if (batchSize > 0 && (i + 1) % batchSize === 0) {
      await sleep(800);
    }
  }

  logger.info(`[token-healthcheck] done: checked=${checked}, invalidated=${invalidated}`);
  return { total: valids.length, checked, invalidated };
}

export function startTokenHealthcheckJob(options: TokenHealthcheckOptions = {}) {
  const schedule = options.schedule ?? '0 */4 * * *'; // every 4 hours
  const runOnStart = options.runOnStart ?? true;

  cron.schedule(
    schedule,
    async () => {
      try {
        await runTokenHealthcheckOnce(options);
      } catch (err: any) {
        logger.error('[token-healthcheck] job error:', err);
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

  logger.info(`[token-healthcheck] cron scheduled: ${schedule} (Asia/Shanghai)`);

  if (runOnStart) {
    runTokenHealthcheckOnce(options).catch((err) => {
      logger.error('[token-healthcheck] runOnStart error:', err);
    });
  }
}
