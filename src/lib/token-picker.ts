import _ from 'lodash';

import { tokenSplit } from '@/api/controllers/core.ts';
import { pickValidToken, markTokenStatusByValue } from '@/lib/token-store.ts';

export interface ResolveTokenResult {
  token: string;
  source: 'header' | 'pool';
}

/**
 * 解析请求 Authorization。如果缺失，则从 Token 池抽取一个有效 token。
 */
export async function resolveTokenFromRequest(headers: any): Promise<ResolveTokenResult> {
  const auth = headers?.authorization || headers?.Authorization;
  if (_.isString(auth) && auth.trim()) {
    const tokens = tokenSplit(auth);
    const token = _.sample(tokens);
    if (token) return { token, source: 'header' };
  }

  const rec = await pickValidToken('roundrobin');
  if (!rec) {
    throw new Error('未提供 Authorization，且 Token 池为空（没有有效 token）');
  }
  return { token: rec.token_value, source: 'pool' };
}

export async function markTokenInvalid(tokenValue: string) {
  await markTokenStatusByValue(tokenValue, 'invalid');
}
