import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import SuccessfulBody from '@/lib/response/SuccessfulBody.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';

import { addToken, deleteToken, importTokens, listTokens } from '@/lib/token-store.ts';
import { runTokenHealthcheckOnce } from '@/lib/token-healthcheck.ts';

export default {
  prefix: '/api/admin/tokens',

  get: {
    '': async (_request: Request) => {
      const tokens = await listTokens();
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
