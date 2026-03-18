import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import SuccessfulBody from '@/lib/response/SuccessfulBody.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';

import { addToken, deleteToken, importTokens, listTokens, resetAllTokenStatus, resetTokenStatusByFilter, updateTokenCreditByValue } from '@/lib/token-store.ts';
import { runTokenHealthcheckOnce } from '@/lib/token-healthcheck.ts';
import { getCredit, receiveCredit } from '@/api/controllers/core.ts';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default {
  prefix: '/api/admin/tokens',

  get: {
    '': async (request: Request) => {
      // 可选过滤：?node=cn|jp|us|hk|sg&status=valid|invalid
      const node = request.query?.node;
      const status = request.query?.status;
      const tokens = await listTokens({
        node: _.isString(node) ? (node as any) : undefined,
        status: _.isString(status) ? (status as any) : undefined,
      });
      return new SuccessfulBody({ tokens });
    },
  },

  post: {
    '': async (request: Request) => {
      request.validate('body.token_value', _.isString);
      const token_value = String(request.body.token_value || '').trim();
      if (!token_value) throw new APIException(EX.API_REQUEST_PARAMS_INVALID, 'token_value 不能为空');
      const rec = await addToken(token_value);
      return new SuccessfulBody({ token: rec });
    },

    '/import': async (request: Request) => {
      request.validate('body.text', _.isString);
      const text = String(request.body.text || '');
      const result = await importTokens(text);
      return new SuccessfulBody(result);
    },

    '/healthcheck': async (_request: Request) => {
      const result = await runTokenHealthcheckOnce({
        batchSize: 20,
        delayMs: 250,
      });
      return new SuccessfulBody(result);
    },

    '/reset': async (request: Request) => {
      // 可选：body.node=cn|jp|us|hk|sg；不传则重置全部
      const node = request.body?.node;
      let changed = 0;
      if (_.isString(node) && node.trim()) {
        changed = await resetTokenStatusByFilter({ node: node.trim() as any }, 'valid');
      } else {
        changed = await resetAllTokenStatus('valid');
      }
      return new SuccessfulBody({ ok: true, changed });
    },

    '/refresh-credits': async (request: Request) => {
      // 可选：body.node=cn|jp|us|hk|sg；不传则刷新全部（会较慢）
      const node = request.body?.node;
      const tokens = await listTokens({
        node: _.isString(node) && node.trim() ? (node.trim() as any) : undefined,
      });

      let updated = 0;
      let received = 0;
      let failed = 0;
      for (const t of tokens) {
        try {
          let c = await getCredit(t.token_value);

          // 如果积分为 0，尝试自动收取今日积分后再查一次
          if (Number(c.totalCredit) <= 0) {
            try {
              const quota = await receiveCredit(t.token_value);
              if (Number(quota) > 0) received++;
              c = await getCredit(t.token_value);
            } catch {
              // ignore receive error, still write current snapshot
            }
          }

          await updateTokenCreditByValue(t.token_value, {
            total: c.totalCredit,
            gift: c.giftCredit,
            purchase: c.purchaseCredit,
            vip: c.vipCredit,
          });
          updated++;
        } catch {
          failed++;
        }
        // 轻微节流，避免压上游
        await sleep(200);
      }

      return new SuccessfulBody({ ok: true, total: tokens.length, updated, received, failed });
    },
  },

  delete: {
    '/:id': async (request: Request) => {
      const id = (request as any).params?.id || (request as any).ctx?.params?.id;
      if (!id || !_.isString(id)) throw new APIException(EX.API_REQUEST_PARAMS_INVALID, 'id 不能为空');
      const ok = await deleteToken(id);
      if (!ok) throw new APIException(EX.API_REQUEST_FAILED, 'Token 不存在或已删除');
      return new SuccessfulBody({ ok: true });
    },
  },
};
