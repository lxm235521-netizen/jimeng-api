import cron from 'node-cron';
import logger from '@/lib/logger.ts';
import { listTokens, TokenRecord } from '@/lib/token-store.ts';
import { getCredit, getTokenLiveStatus } from '@/api/controllers/core.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';

export interface TokenHealthcheckOptions {
  schedule?: string; // cron expression
  runOnStart?: boolean;
  batchSize?: number;
  delayMs?: number;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 存活检测策略：调用低消耗的“积分查询”接口。
 * - 能成功拿到积分信息 -> valid
 * - ret=1015 / Token 已失效 -> invalid
 * - ret=34010105 / login error（典型未登录/无效会话） -> invalid
 * - 其他网络/上游波动 -> unknown（不改状态，避免误杀）
 */
async function checkOne(token: TokenRecord): Promise<'valid' | 'invalid' | 'unknown'> {
  try {
    // 先用“账号信息”轻量判断是否登录有效
    const live = await getTokenLiveStatus(token.token_value);
    if (!live) return 'invalid';

    // 再用“积分查询”进一步确认链路可用
    await getCredit(token.token_value);
    return 'valid';
  } catch (err: any) {
    const msg = String(err?.errmsg || err?.message || '');

    // 明确的登录失效：判 invalid
    if (err instanceof APIException) {
      if (err.compare(EX.API_TOKEN_EXPIRES)) return 'invalid';
    }
    if (msg.includes('login error') || msg.includes('34010105')) {
      return 'invalid';
    }

    // 其他错误（含网络错误、上游限流等）不直接判死
    return 'unknown';
  }
}

export async function runTokenHealthcheckOnce(options: TokenHealthcheckOptions = {}) {
  const batchSize = options.batchSize ?? 20;
  const delayMs = options.delayMs ?? 250;

  const tokens = await listTokens();
  const candidates = tokens;

  if (candidates.length === 0) {
    logger.info('[token-healthcheck] no tokens');
    return { total: 0, checked: 0, invalidated: 0, unknown: 0 };
  }

  logger.info(`[token-healthcheck] start: total=${candidates.length}`);

  let checked = 0;
  let invalidated = 0;
  let unknown = 0;

  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i];

    const result = await checkOne(t);
    checked++;

    if (result === 'invalid') {
      invalidated++;
      // 注意：不再写回 token.status，避免误判导致可用 token 被标记为 invalid
      logger.warn(`[token-healthcheck] invalid token (no status change): ${t.id}`);
    } else if (result === 'unknown') {
      unknown++;
      logger.warn(`[token-healthcheck] unknown (keep status): ${t.id}`);
    }

    // 轻微节流，避免压上游
    if (delayMs > 0) await sleep(delayMs);
    if (batchSize > 0 && (i + 1) % batchSize === 0) {
      await sleep(800);
    }
  }

  logger.info(`[token-healthcheck] done: checked=${checked}, invalidated=${invalidated}, unknown=${unknown}`);
  return { total: candidates.length, checked, invalidated, unknown };
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
