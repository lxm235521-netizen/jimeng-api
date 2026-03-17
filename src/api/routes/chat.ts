import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';
import util from '@/lib/util.ts';

import { submitTask } from '@/lib/task-runner.ts';
import { generateVideo } from '@/api/controllers/videos.ts';
import { resolveTokenFromRequest, markTokenInvalid } from '@/lib/token-picker.ts';

function normalizeNode(v: any): 'cn' | 'us' | 'jp' | 'hk' | 'sg' | undefined {
  if (!_.isString(v)) return undefined;
  const s = v.toLowerCase().trim();
  if (['cn', 'us', 'jp', 'hk', 'sg'].includes(s)) return s as any;
  return undefined;
}

function isNoCreditsError(err: any): boolean {
  const msg = String(err?.errmsg || err?.message || '').toLowerCase();
  const has1006 = msg.includes('1006') || msg.includes('错误码: 1006') || msg.includes('(错误码: 1006)');
  const looksLikeNoCredit =
    msg.includes('not enough credits') ||
    msg.includes('no relevant benefits') ||
    msg.includes('积分不足') ||
    msg.includes('无积分');
  return has1006 && looksLikeNoCredit;
}

function extractPrompt(body: any): string {
  if (_.isString(body?.prompt) && body.prompt.trim()) return body.prompt.trim();
  const messages = body?.messages;
  if (!_.isArray(messages)) return '';

  const texts: string[] = [];
  for (const m of messages) {
    if (!m) continue;
    const role = String(m.role || '').toLowerCase();
    if (role !== 'user') continue;
    const content = m.content;
    if (_.isString(content) && content.trim()) {
      texts.push(content.trim());
      continue;
    }
    // OpenAI vision-style: content = [{type:'text', text:'...'}, ...]
    if (_.isArray(content)) {
      for (const p of content) {
        if (p?.type === 'text' && _.isString(p.text) && p.text.trim()) {
          texts.push(p.text.trim());
        }
      }
    }
  }
  return texts.join('\n').trim();
}

function parseDataUrlToB64(dataUrl: string): { mime?: string; b64: string } | null {
  const s = String(dataUrl || '').trim();
  if (!s.startsWith('data:')) return null;
  const m = s.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  return { mime: m[1], b64: m[2] };
}

function extractFirstLastFrames(body: any): { first?: { mime?: string; b64: string }; last?: { mime?: string; b64: string } } {
  const messages = body?.messages;
  if (!_.isArray(messages)) return {};

  const imgs: { mime?: string; b64: string }[] = [];
  for (const m of messages) {
    if (!m) continue;
    const role = String(m.role || '').toLowerCase();
    if (role !== 'user') continue;
    const content = m.content;
    if (!_.isArray(content)) continue;
    for (const p of content) {
      if (p?.type !== 'image_url') continue;
      const url = p?.image_url?.url;
      if (!_.isString(url) || !url.trim()) continue;
      const parsed = parseDataUrlToB64(url);
      if (parsed) imgs.push(parsed);
      if (imgs.length >= 2) break;
    }
    if (imgs.length >= 2) break;
  }
  return { first: imgs[0], last: imgs[1] };
}

export default {
  prefix: '/v1/chat',
  post: {
    '/completions': async (request: Request) => {
      request
        .validate('body.model', _.isString)
        .validate('body.messages', (v) => _.isArray(v) || _.isUndefined(v))
        .validate('body.prompt', (v) => _.isString(v) || _.isUndefined(v));

      const model = String(request.body.model || '').trim();
      const prompt = extractPrompt(request.body);
      if (!prompt) throw new APIException(EX.API_REQUEST_PARAMS_INVALID, 'prompt 不能为空（或 messages 中缺少 user 文本）');

      // 仅把 jimeng-video-* 转为“视频异步任务”；其他模型暂不处理
      if (!model.startsWith('jimeng-video-')) {
        throw new APIException(EX.API_REQUEST_PARAMS_INVALID, `chat/completions 暂不支持该 model: ${model}`);
      }

      const node = normalizeNode(request.headers?.['x-token-node'] || request.headers?.['X-Token-Node']);

      const ratio = _.isString(request.body?.ratio) ? request.body.ratio : undefined;
      const resolution = _.isString(request.body?.resolution) ? request.body.resolution : undefined;
      const duration = _.isFinite(request.body?.duration) ? Number(request.body.duration) : undefined;
      const functionMode = _.isString(request.body?.functionMode) ? request.body.functionMode : 'first_last_frames';
      const frames = extractFirstLastFrames(request.body);

      const payload = {
        kind: 'chat->video',
        model,
        prompt,
        ratio,
        resolution,
        duration,
        functionMode,
        frames,
      };

      const task = await submitTask({
        type: 'video',
        node,
        ttlMs: 30 * 60 * 1000,
        payload,
        run: async () => {
          const firstB64 = (payload as any)?.frames?.first?.b64;
          const lastB64 = (payload as any)?.frames?.last?.b64;
          let lastErr: any;
          for (let attempt = 0; attempt < 5; attempt++) {
            // 强制走 token 池，避免 NewAPI 的 Authorization 影响
            const picked = await resolveTokenFromRequest({ 'X-Token-Node': node, 'X-From-NewAPI': '1' });
            try {
              const files: any = {};
              if (_.isString(firstB64) && firstB64) {
                files.first = {
                  filepath: '',
                  originalFilename: 'first.png',
                  buffer: Buffer.from(firstB64, 'base64'),
                };
              }
              if (_.isString(lastB64) && lastB64) {
                files.last = {
                  filepath: '',
                  originalFilename: 'last.png',
                  buffer: Buffer.from(lastB64, 'base64'),
                };
              }
              const url = await generateVideo(
                model,
                prompt,
                {
                  ratio: ratio || '1:1',
                  resolution: resolution || '720p',
                  duration: duration || 5,
                  functionMode,
                  files: Object.keys(files).length > 0 ? files : undefined,
                  httpRequest: { body: payload, files },
                } as any,
                picked.token
              );
              return { created: util.unixTimestamp(), data: [{ url, revised_prompt: prompt }] };
            } catch (err: any) {
              lastErr = err;
              if (picked.source === 'pool') {
                if (isNoCreditsError(err) || (err instanceof APIException && err.compare(EX.API_TOKEN_EXPIRES))) {
                  await markTokenInvalid(picked.token);
                  continue;
                }
              }
              throw err;
            }
          }
          throw lastErr;
        },
      });

      const created = util.unixTimestamp();
      const chatId = `chatcmpl_${util.uuid()}`;
      const taskInfo = { task_id: task.id, status: 'processing', poll: `/v1/tasks/${task.id}` };

      return {
        id: chatId,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(taskInfo) },
            finish_reason: 'stop',
          },
        ],
        // usage 字段可选；这里给占位，避免部分客户端解析报错
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        task_id: task.id,
        task: taskInfo,
      };
    },
  },
};

