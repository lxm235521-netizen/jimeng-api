import fs from "fs";
import _ from "lodash";

import Request from "@/lib/request/Request.ts";
import { generateImages, generateImageComposition } from "@/api/controllers/images.ts";
import { DEFAULT_IMAGE_MODEL } from "@/api/consts/common.ts";
import util from "@/lib/util.ts";

import { resolveTokenFromRequest, markTokenInvalid } from "@/lib/token-picker.ts";
import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";

function isNoCreditsError(err: any): boolean {
  const msg = String(err?.errmsg || err?.message || '');
  return msg.includes('(错误码: 1006)') || msg.includes('错误码: 1006') || msg.includes('1006');
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
        .validate("body.response_format", (v) => _.isUndefined(v) || _.isString(v));

      const { token, source } = await resolveTokenFromRequest(request.headers);

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

      const responseFormat = _.defaultTo(response_format, "url");

      let imageUrls: string[];
      try {
        imageUrls = await generateImages(
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
      } catch (err: any) {
        // 仅在 token 来自池时处理状态写入
        if (source === 'pool') {
          // 积分不足（1006）：标记为不可用，避免后续继续选中
          if (isNoCreditsError(err)) {
            await markTokenInvalid(token);
          }
          // 仍保留登录失效的标记（可选）
          if (err instanceof APIException && err.compare(EX.API_TOKEN_EXPIRES)) {
            await markTokenInvalid(token);
          }
        }
        throw err;
      }

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

      const { token, source } = await resolveTokenFromRequest(request.headers);

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

      let resultUrls: string[];
      try {
        resultUrls = await generateImageComposition(
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
      } catch (err: any) {
        if (source === 'pool') {
          if (isNoCreditsError(err)) {
            await markTokenInvalid(token);
          }
          if (err instanceof APIException && err.compare(EX.API_TOKEN_EXPIRES)) {
            await markTokenInvalid(token);
          }
        }
        throw err;
      }

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
    },
  },
};
