import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import config from '@/lib/config.ts';
import util from '@/lib/util.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';
import SuccessfulBody from '@/lib/response/SuccessfulBody.ts';

// JWT
import jwt from 'jsonwebtoken';

function getJwtSecret(): string {
  // 生产环境请务必配置
  return process.env.ADMIN_JWT_SECRET || 'jimeng-api-admin-secret';
}

export default {
  prefix: '/api/admin',

  post: {
    '/login': async (request: Request) => {
      request
        .validate('body.username', _.isString)
        .validate('body.password', _.isString);

      const { username, password } = request.body;
      const expectedUsername = config.system.web_ui?.username || 'admin';
      const expectedPassword = config.system.web_ui?.password || 'admin';

      if (username !== expectedUsername || password !== expectedPassword) {
        throw new APIException(EX.API_REQUEST_FAILED, '账号或密码错误');
      }

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: username,
        iat: now,
        // 8小时有效期
        exp: now + 8 * 60 * 60,
        jti: util.uuid(),
      };

      const token = jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256' });

      // 统一返回格式，便于前端/脚本处理
      return new SuccessfulBody({
        token,
        exp: payload.exp,
      });
    },
  },
};
