import Request from '@/lib/request/Request.ts';
import SuccessfulBody from '@/lib/response/SuccessfulBody.ts';

export default {
  prefix: '/api/admin',

  get: {
    '/me': async (request: Request) => {
      // 由 auth 中间件注入（在 server.ts 里写入 ctx.state.admin）
      const admin = (request as any).ctx?.state?.admin;
      return new SuccessfulBody({ admin });
    },
  },
};
