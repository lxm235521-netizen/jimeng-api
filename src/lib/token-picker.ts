import _ from 'lodash';

import { tokenSplit } from '@/api/controllers/core.ts';
import { pickValidToken, markTokenStatusByValue, type TokenNode } from '@/lib/token-store.ts';

export interface ResolveTokenResult {
  token: string;
  source: 'header' | 'pool';
}

function normalizeNode(v: any): TokenNode | null {
  if (!_.isString(v)) return null;
  const s = v.toLowerCase().trim();
  if (['cn', 'us', 'jp', 'hk', 'sg'].includes(s)) return s as TokenNode;
  return null;
}

/**
 * 解析请求 Authorization。如果缺失，则从 Token 池抽取一个有效 token。
 *
 * 支持通过 header 指定节点：
 * - X-Token-Node: cn|jp|us|hk|sg
 */
export async function resolveTokenFromRequest(headers: any): Promise<ResolveTokenResult> {
  const auth = headers?.authorization || headers?.Authorization;
  if (_.isString(auth) && auth.trim()) {
    const tokens = tokenSplit(auth);
    const token = _.sample(tokens);
    if (token) return { token, source: 'header' };
  }

  const node = normalizeNode(headers?.['x-token-node'] || headers?.['X-Token-Node']);

  const rec = await pickValidToken('roundrobin', node ? { node } : undefined);
  if (!rec) {
    throw new Error(node
      ? `未提供 Authorization，且 Token 池为空（没有有效 token，node=${node}）`
      : '未提供 Authorization，且 Token 池为空（没有有效 token）'
    );
  }
  return { token: rec.token_value, source: 'pool' };
}

export async function markTokenInvalid(tokenValue: string) {
  await markTokenStatusByValue(tokenValue, 'invalid');
}
