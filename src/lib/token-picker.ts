import _ from 'lodash';

import { tokenSplit } from '@/api/controllers/core.ts';
import { pickValidToken, markTokenStatusByValue, type TokenNode } from '@/lib/token-store.ts';

export interface ResolveTokenResult {
  token: string;
  source: 'header' | 'pool';
  node?: TokenNode | null;
}

function normalizeNode(v: any): TokenNode | null {
  if (!_.isString(v)) return null;
  const s = v.toLowerCase().trim();
  if (['cn', 'us', 'jp', 'hk', 'sg'].includes(s)) return s as TokenNode;
  return null;
}

function looksLikeJwt(token: string): boolean {
  // rough check: 3 segments separated by '.' and each segment is base64url-ish
  const s = (token || '').trim();
  if (!s) return false;
  const parts = s.split('.');
  if (parts.length !== 3) return false;
  const re = /^[A-Za-z0-9_-]+$/;
  return parts.every((p) => p.length > 10 && re.test(p));
}

/**
 * 解析请求 Authorization。如果缺失，则从 Token 池抽取一个有效 token。
 *
 * 支持通过 header 指定节点：
 * - X-Token-Node: cn|jp|us|hk|sg
 */
export async function resolveTokenFromRequest(headers: any): Promise<ResolveTokenResult> {
  const node = normalizeNode(headers?.['x-token-node'] || headers?.['X-Token-Node']);

  const auth = headers?.authorization || headers?.Authorization;
  if (_.isString(auth) && auth.trim()) {
    const tokens = tokenSplit(auth);
    const token = _.sample(tokens);

    // 兼容：Web 管理后台可能会误把 admin JWT 带到 /v1 接口
    // JWT 不能作为即梦 sessionid 使用，此时忽略 header，走 Token 池
    if (token && !looksLikeJwt(token)) {
      return { token, source: 'header', node };
    }
  }

  const rec = await pickValidToken('roundrobin', node ? { node } : undefined);
  if (!rec) {
    throw new Error(
      node
        ? `未提供生成 Token，且 Token 池为空（没有有效 token，node=${node}）`
        : '未提供生成 Token，且 Token 池为空（没有有效 token）'
    );
  }
  return { token: rec.token_value, source: 'pool', node };
}

export async function markTokenInvalid(tokenValue: string) {
  await markTokenStatusByValue(tokenValue, 'invalid');
}
