import _ from 'lodash';

import { pickValidToken, markTokenStatusByValue, type TokenRecord } from '@/lib/token-store.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';

export type TokenSource = 'header' | 'pool';

export interface ResolvedToken {
  token: string;
  source: TokenSource;
  record?: TokenRecord;
}

/**
 * 从请求 Authorization 获取 token；若不存在，则从 Token 池挑选一个有效 token。
 * - 返回的是“包含站点前缀的完整 sessionid”（例如 us-xxx / hk-xxx / 纯 CN token）
 */
export async function resolveRequestToken(
  authorizationHeader: string | undefined,
  strategy: 'random' | 'roundrobin' = 'roundrobin'
): Promise<ResolvedToken> {
  const auth = String(authorizationHeader || '').trim();

  // 1) 用户显式携带 Authorization -> 按原逻辑切分，随机一个
  if (auth) {
    const tokens = tokenSplit(auth);
    const token = _.sample(tokens);
    if (token) return { token, source: 'header' };
  }

  // 2) 无 Authorization -> 从 token 池抽取
  const record = await pickValidToken(strategy);
  if (!record) {
    throw new Error('缺少 Authorization，且 Token 池为空：请在管理后台导入可用的 sessionid token');
  }
  return { token: record.token_value, source: 'pool', record };
}

/**
 * 当使用 Token 池执行请求时：
 * - 若遇到 Token 失效错误，自动把该 token 标记为 invalid，并重试换一个。
 * - header token 不做自动标记与重试（避免误伤用户显式传入的 token）。
 */
export async function withPoolTokenRetry<T>(
  fn: (token: string) => Promise<T>,
  options: { maxAttempts?: number; strategy?: 'random' | 'roundrobin' } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const strategy = options.strategy || 'roundrobin';

  let lastErr: any;

  for (let i = 0; i < maxAttempts; i++) {
    const picked = await pickValidToken(strategy);
    if (!picked) throw new Error('Token 池为空：请在管理后台导入可用 token');

    try {
      return await fn(picked.token_value);
    } catch (e: any) {
      lastErr = e;

      // 仅对“明确的 Token 失效”做自动淘汰
      if (e instanceof APIException && e.compare(EX.API_TOKEN_EXPIRES)) {
        await markTokenStatusByValue(picked.token_value, 'invalid');
        continue;
      }

      // 其它错误直接抛出（例如内容违规、积分不足、参数错误）
      throw e;
    }
  }

  throw lastErr || new Error('Token 池重试失败');
}
