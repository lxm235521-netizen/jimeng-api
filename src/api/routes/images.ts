import fs from "fs";
import _ from "lodash";

import Request from "@/lib/request/Request.ts";
import { generateImages, generateImageComposition } from "@/api/controllers/images.ts";
import { DEFAULT_IMAGE_MODEL } from "@/api/consts/common.ts";
import util from "@/lib/util.ts";

import { resolveTokenFromRequest, markTokenInvalid } from "@/lib/token-picker.ts";
import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import { submitTask } from "@/lib/task-runner.ts";

function isNoCreditsError(err: any): boolean {
  const msg = String(err?.errmsg || err?.message || '');
  return msg.includes('(错误码: 1006)') || msg.includes('错误码: 1006') || msg.includes('1006');
}

function normalizeNode(v: any): 'cn' | 'us' | 'jp' | 'hk' | 'sg' | undefined {
  if (!_.isString(v)) return undefined;
  const s = v.toLowerCase().trim();
  if (['cn', 'us', 'jp', 'hk', 'sg'].includes(s)) return s as any;
  return undefined;
}

function parseAsyncFlag(v: any): boolean {
  if (_.isBoolean(v)) return v;
  if (_.isString(v)) return v.trim().toLowerCase() === 'true' || v.trim() === '1';
  if (_.isFinite(v)) return Number(v) === 1;
  return false;
}

export default {
  prefix: "/v1/images",

  post: {
    "/generations": async (request: Request) => {
      const unsupportedParams = ["size", "width", "height"];
      const bodyKeys = Object.keys(request.body);
      const foundUnsupported = unsupportedParams.filter((param) =>
        bodyKeys.includes(param)
      );

      if (foundUnsupported.length > 0) {
        throw new Error(
          `不支持的参数: ${foundUnsupported.join(", ")}。请使用 ratio 和 resolution 参数控制图像尺寸。`
        );
      }

      request
        .validate("body.model", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.prompt", _.isString)
        .validate("body.negative_prompt", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.ratio", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.resolution", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.intelligent_ratio", (v) => _.isUndefined(v) || _.isBoolean(v))
        .validate("body.sample_strength", (v) => _.isUndefined(v) || _.isFinite(v))
        .validate("body.response_format", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.async", (v) => _.isUndefined(v) || _.isBoolean(v) || _.isString(v) || _.isFinite(v));

      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        ratio,
        resolution,
        intelligent_ratio: intelligentRatio,
        sample_strength: sampleStrength,
        response_format,
        async,
      } = request.body;
      const finalModel = _.defaultTo(model, DEFAULT_IMAGE_MODEL);

      const responseFormat = _.defaultTo(response_format, "url");

      // async=true：创建任务并立即返回 task_id（用于对接 NewAPI 计费 + Cloudflare 100s 超时限制）
      const asyncMode = parseAsyncFlag(async);
      if (asyncMode) {
        const node = normalizeNode(request.headers?.['x-token-node'] || request.headers?.['X-Token-Node']);
        const payload = { ...request.body };
        const task = await submitTask({
          type: 'image',
          node,
          ttlMs: 8 * 60 * 1000,
          payload: { kind: 'generations', body: payload },
          run: async () => {
            const { generateImages } = await import('@/api/controllers/images.ts');
            const { resolveTokenFromRequest, markTokenInvalid } = await import('@/lib/token-picker.ts');

            const {
              model,
              prompt,
              negative_prompt: negativePrompt,
              ratio,
              resolution,
              intelligent_ratio: intelligentRatio,
              sample_strength: sampleStrength,
              response_format,
            } = payload as any;

            const finalModel = _.defaultTo(model, DEFAULT_IMAGE_MODEL);
            const responseFormat = _.defaultTo(response_format, "url");

            let lastErr: any;
            for (let attempt = 0; attempt < 5; attempt++) {
              const picked = await resolveTokenFromRequest({ 'X-Token-Node': node });
              try {
                const imageUrls = await generateImages(
                  finalModel,
                  prompt,
                  { ratio, resolution, sampleStrength, negativePrompt, intelligentRatio },
                  picked.token
                );
                let data: any[] = [];
                if (responseFormat == "b64_json") {
                  data = (await Promise.all(imageUrls.map((url) => util.fetchFileBASE64(url)))).map((b64) => ({ b64_json: b64 }));
                } else {
                  data = imageUrls.map((url) => ({ url }));
                }
                return { created: util.unixTimestamp(), data };
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
        return { created: util.unixTimestamp(), task_id: task.id, status: 'processing' };
      }

      // Token 池自动重试：
      // - 积分不足（1006）或 token 失效：将该 token 标记为不可用并换下一个重试
      // - 其他错误：直接抛出
      let lastErr: any;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { token, source } = await resolveTokenFromRequest(request.headers);
        try {
          const imageUrls = await generateImages(
            finalModel,
            prompt,
            {
              ratio,
              resolution,
              sampleStrength,
              negativePrompt,
              intelligentRatio,
            },
            token
          );

          let data: any[] = [];
          if (responseFormat == "b64_json") {
            data = (
              await Promise.all(imageUrls.map((url) => util.fetchFileBASE64(url)))
            ).map((b64) => ({ b64_json: b64 }));
          } else {
            data = imageUrls.map((url) => ({ url }));
          }
          return {
            created: util.unixTimestamp(),
            data,
          };
        } catch (err: any) {
          lastErr = err;
          if (source === 'pool') {
            if (isNoCreditsError(err) || (err instanceof APIException && err.compare(EX.API_TOKEN_EXPIRES))) {
              await markTokenInvalid(token);
              continue;
            }
          }
          throw err;
        }
      }
      throw lastErr;

    },

    "/generations/submit": async (request: Request) => {
      request
        .validate("body.model", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.prompt", _.isString)
        .validate("body.negative_prompt", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.ratio", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.resolution", (v) => _.isUndefined(v) || _.isString(v))
        .validate("body.intelligent_ratio", (v) => _.isUndefined(v) || _.isBoolean(v))
        .validate("body.sample_strength", (v) => _.isUndefined(v) || _.isFinite(v))
        .validate("body.response_format", (v) => _.isUndefined(v) || _.isString(v));

      const node = normalizeNode(request.headers?.['x-token-node'] || request.headers?.['X-Token-Node']);
      const payload = { ...request.body };
      const task = await submitTask({
        type: 'image',
        node,
        ttlMs: 8 * 60 * 1000,
        payload: { kind: 'generations', headers: { 'x-token-node': node }, body: payload },
        run: async () => {
          // 复用当前同步逻辑：直接调用本路由的处理函数太绕，重用 controllers 更稳
          const { generateImages } = await import('@/api/controllers/images.ts');
          const { resolveTokenFromRequest, markTokenInvalid } = await import('@/lib/token-picker.ts');
          const { token, source } = await resolveTokenFromRequest({ 'X-Token-Node': node });

          const {
            model,
            prompt,
            negative_prompt: negativePrompt,
            ratio,
            resolution,
            intelligent_ratio: intelligentRatio,
            sample_strength: sampleStrength,
            response_format,
          } = payload as any;

          const finalModel = _.defaultTo(model, DEFAULT_IMAGE_MODEL);
          const responseFormat = _.defaultTo(response_format, "url");

          let lastErr: any;
          for (let attempt = 0; attempt < 5; attempt++) {
            const picked = await resolveTokenFromRequest({ 'X-Token-Node': node });
            try {
              const imageUrls = await generateImages(
                finalModel,
                prompt,
                { ratio, resolution, sampleStrength, negativePrompt, intelligentRatio },
                picked.token
              );

              let data: any[] = [];
              if (responseFormat == "b64_json") {
                data = (await Promise.all(imageUrls.map((url) => util.fetchFileBASE64(url)))).map((b64) => ({ b64_json: b64 }));
              } else {
                data = imageUrls.map((url) => ({ url }));
              }
              return { created: util.unixTimestamp(), data };
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

      return { created: util.unixTimestamp(), task_id: task.id, status: 'processing' };
    },

    "/compositions": async (request: Request) => {
      const unsupportedParams = ["size", "width", "height"];
      const bodyKeys = Object.keys(request.body);
      const foundUnsupported = unsupportedParams.filter((param) =>
        bodyKeys.includes(param)
      );

      if (foundUnsupported.length > 0) {
        throw new Error(
          `不支持的参数: ${foundUnsupported.join(", ")}。请使用 ratio 和 resolution 参数控制图像尺寸。`
        );
      }

      const contentType = request.headers["content-type"] || "";
      const isMultiPart = contentType.startsWith("multipart/form-data");

      if (isMultiPart) {
        request
          .validate("body.model", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.prompt", _.isString)
          .validate("body.negative_prompt", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.ratio", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.resolution", (v) => _.isUndefined(v) || _.isString(v))
          .validate(
            "body.intelligent_ratio",
            (v) =>
              _.isUndefined(v) ||
              (typeof v === "string" && (v === "true" || v === "false")) ||
              _.isBoolean(v)
          )
          .validate(
            "body.sample_strength",
            (v) =>
              _.isUndefined(v) ||
              (typeof v === "string" && !isNaN(parseFloat(v))) ||
              _.isFinite(v)
          )
          .validate("body.response_format", (v) => _.isUndefined(v) || _.isString(v));
      } else {
        request
          .validate("body.model", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.prompt", _.isString)
          .validate("body.images", _.isArray)
          .validate("body.negative_prompt", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.ratio", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.resolution", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.intelligent_ratio", (v) => _.isUndefined(v) || _.isBoolean(v))
          .validate("body.sample_strength", (v) => _.isUndefined(v) || _.isFinite(v))
          .validate("body.response_format", (v) => _.isUndefined(v) || _.isString(v));
      }

      let images: (string | Buffer)[] = [];
      if (isMultiPart) {
        const files = request.files?.images;
        if (!files) {
          throw new Error("在form-data中缺少 'images' 字段");
        }
        const imageFiles = Array.isArray(files) ? files : [files];
        if (imageFiles.length === 0) {
          throw new Error("至少需要提供1张输入图片");
        }
        if (imageFiles.length > 10) {
          throw new Error("最多支持10张输入图片");
        }
        images = imageFiles.map((file) => fs.readFileSync(file.filepath));
      } else {
        const bodyImages = request.body.images;
        if (!bodyImages || bodyImages.length === 0) {
          throw new Error("至少需要提供1张输入图片");
        }
        if (bodyImages.length > 10) {
          throw new Error("最多支持10张输入图片");
        }
        bodyImages.forEach((image: any, index: number) => {
          if (!_.isString(image) && !_.isObject(image)) {
            throw new Error(
              `图片 ${index + 1} 格式不正确：应为URL字符串或包含url字段的对象`
            );
          }
          if (_.isObject(image) && !image.url) {
            throw new Error(`图片 ${index + 1} 缺少url字段`);
          }
        });
        images = bodyImages.map((image: any) =>
          _.isString(image) ? image : image.url
        );
      }

      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        ratio,
        resolution,
        intelligent_ratio: intelligentRatio,
        sample_strength: sampleStrength,
        response_format,
      } = request.body;
      const finalModel = _.defaultTo(model, DEFAULT_IMAGE_MODEL);

      // 如果是 multipart/form-data，需要将字符串转换为数字和布尔值
      const finalSampleStrength =
        isMultiPart && typeof sampleStrength === "string"
          ? parseFloat(sampleStrength)
          : sampleStrength;

      const finalIntelligentRatio =
        isMultiPart && typeof intelligentRatio === "string"
          ? intelligentRatio === "true"
          : intelligentRatio;

      const responseFormat = _.defaultTo(response_format, "url");

      let lastErr: any;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { token, source } = await resolveTokenFromRequest(request.headers);
        try {
          const resultUrls = await generateImageComposition(
            finalModel,
            prompt,
            images,
            {
              ratio,
              resolution,
              sampleStrength: finalSampleStrength,
              negativePrompt,
              intelligentRatio: finalIntelligentRatio,
            },
            token
          );

          let data: any[] = [];
          if (responseFormat == "b64_json") {
            data = (
              await Promise.all(resultUrls.map((url) => util.fetchFileBASE64(url)))
            ).map((b64) => ({ b64_json: b64 }));
          } else {
            data = resultUrls.map((url) => ({ url }));
          }

          return {
            created: util.unixTimestamp(),
            data,
            input_images: images.length,
            composition_type: "multi_image_synthesis",
          };
        } catch (err: any) {
          lastErr = err;
          if (source === 'pool') {
            if (isNoCreditsError(err) || (err instanceof APIException && err.compare(EX.API_TOKEN_EXPIRES))) {
              await markTokenInvalid(token);
              continue;
            }
          }
          throw err;
        }
      }
      throw lastErr;

    },

    "/compositions/submit": async (request: Request) => {
      const contentType = request.headers["content-type"] || "";
      const isMultiPart = contentType.startsWith("multipart/form-data");

      if (isMultiPart) {
        request
          .validate("body.model", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.prompt", _.isString)
          .validate("body.negative_prompt", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.ratio", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.resolution", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.response_format", (v) => _.isUndefined(v) || _.isString(v));
      } else {
        request
          .validate("body.model", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.prompt", _.isString)
          .validate("body.images", _.isArray)
          .validate("body.negative_prompt", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.ratio", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.resolution", (v) => _.isUndefined(v) || _.isString(v))
          .validate("body.response_format", (v) => _.isUndefined(v) || _.isString(v));
      }

      const node = normalizeNode(request.headers?.['x-token-node'] || request.headers?.['X-Token-Node']);

      // 把输入图片在提交时转成 payload（避免后台任务依赖临时文件路径）
      let imagesPayload: any;
      if (isMultiPart) {
        const files = request.files?.images;
        if (!files) throw new Error("在form-data中缺少 'images' 字段");
        const imageFiles = Array.isArray(files) ? files : [files];
        imagesPayload = imageFiles.map((f) => ({
          name: f.originalFilename,
          b64: fs.readFileSync(f.filepath).toString('base64'),
        }));
      } else {
        imagesPayload = (request.body.images || []).map((x: any) => (_.isString(x) ? x : x?.url)).filter(Boolean);
      }

      const payload = { ...request.body, imagesPayload, isMultiPart };
      const task = await submitTask({
        type: 'image',
        node,
        ttlMs: 8 * 60 * 1000,
        payload: { kind: 'compositions', body: payload },
        run: async () => {
          const { generateImageComposition } = await import('@/api/controllers/images.ts');
          const { resolveTokenFromRequest, markTokenInvalid } = await import('@/lib/token-picker.ts');

          const {
            model,
            prompt,
            negative_prompt: negativePrompt,
            ratio,
            resolution,
            intelligent_ratio: intelligentRatio,
            sample_strength: sampleStrength,
            response_format,
            imagesPayload,
            isMultiPart,
          } = payload as any;

          const finalModel = _.defaultTo(model, DEFAULT_IMAGE_MODEL);
          const responseFormat = _.defaultTo(response_format, "url");

          const images: (string | Buffer)[] = isMultiPart
            ? (imagesPayload as any[]).map((x) => Buffer.from(x.b64, 'base64'))
            : (imagesPayload as string[]);

          let lastErr: any;
          for (let attempt = 0; attempt < 5; attempt++) {
            const picked = await resolveTokenFromRequest({ 'X-Token-Node': node });
            try {
              const urls = await generateImageComposition(
                finalModel,
                prompt,
                images,
                {
                  ratio,
                  resolution,
                  sampleStrength,
                  negativePrompt,
                  intelligentRatio,
                },
                picked.token
              );
              let data: any[] = [];
              if (responseFormat == "b64_json") {
                data = (await Promise.all(urls.map((url) => util.fetchFileBASE64(url)))).map((b64) => ({ b64_json: b64 }));
              } else {
                data = urls.map((url) => ({ url }));
              }
              return { created: util.unixTimestamp(), data };
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

      return { created: util.unixTimestamp(), task_id: task.id, status: 'processing' };
    },
  },
};
