import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';
import { getTask } from '@/lib/task-store.ts';

export default {
  prefix: '/v1/tasks',

  get: {
    '/:id': async (request: Request) => {
      const id = (request as any).params?.id || (request as any).ctx?.params?.id;
      if (!id || !_.isString(id)) throw new APIException(EX.API_REQUEST_PARAMS_INVALID, 'task_id 不能为空');

      const task = await getTask(id);
      if (!task) throw new APIException(EX.API_REQUEST_FAILED, '任务不存在或已过期');

      // 统一返回结构：200 + processing/succeeded/failed
      if (task.status === 'processing') {
        return { task_id: task.id, status: 'processing' };
      }
      if (task.status === 'failed') {
        return { task_id: task.id, status: 'failed', error: task.error || { message: '任务失败' } };
      }
      return { task_id: task.id, status: 'succeeded', result: task.result };
    },
  },
};

