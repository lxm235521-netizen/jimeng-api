import _ from 'lodash';
import fs from 'fs';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { generateVideo, DEFAULT_MODEL } from '@/api/controllers/videos.ts';
import util from '@/lib/util.ts';

import { resolveTokenFromRequest, markTokenInvalid } from '@/lib/token-picker.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';
import { submitTask } from '@/lib/task-runner.ts';

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

    prefix: '/v1/videos',

    post: {

        '/generations': async (request: Request) => {
            const contentType = request.headers['content-type'] || '';
            const isMultiPart = contentType.startsWith('multipart/form-data');

            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.prompt', _.isString)
                .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
                .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
                .validate('body.functionMode', v => _.isUndefined(v) || (_.isString(v) && ['first_last_frames', 'omni_reference'].includes(v)))
                .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
                .validate('body.async', v => _.isUndefined(v) || _.isBoolean(v) || _.isString(v) || _.isFinite(v));

            const functionMode = request.body.functionMode || 'first_last_frames';
            const isOmniMode = functionMode === 'omni_reference';
            const asyncMode = parseAsyncFlag(request.body.async);

            // async=true：创建任务并立即返回 task_id
            if (asyncMode) {
                // 复用已有的 submit 逻辑（支持 multipart）
                // 直接调用 submit 路由处理函数不方便，这里内联提交任务逻辑
                const node = normalizeNode(request.headers?.['x-token-node'] || request.headers?.['X-Token-Node']);

                // 把首帧/尾帧图片在提交时转成 base64（避免后台任务依赖临时文件路径）
                const filesPayload: { first_b64?: string; last_b64?: string } = {};
                if (isMultiPart && request.files) {
                    const uploadedFiles = _.values(request.files);
                    if (uploadedFiles[0]) {
                        const f: any = uploadedFiles[0];
                        filesPayload.first_b64 = fs.readFileSync(f.filepath).toString('base64');
                    }
                    if (uploadedFiles[1]) {
                        const f: any = uploadedFiles[1];
                        filesPayload.last_b64 = fs.readFileSync(f.filepath).toString('base64');
                    }
                }

                const payload = { ...request.body, isMultiPart, filesPayload };
                const task = await submitTask({
                    type: 'video',
                    node,
                    ttlMs: 8 * 60 * 1000,
                    payload: { kind: 'generations', body: payload },
                    run: async () => {
                        const {
                            model = DEFAULT_MODEL,
                            prompt,
                            ratio = "1:1",
                            resolution = "720p",
                            duration = 5,
                            file_paths = [],
                            filePaths = [],
                            response_format = "url",
                            functionMode = 'first_last_frames',
                            isMultiPart,
                            filesPayload,
                        } = payload as any;

                        const finalDuration = isMultiPart && typeof duration === 'string' ? parseInt(duration) : duration;
                        const finalFilePaths = filePaths.length > 0 ? filePaths : file_paths;

                        let lastErr: any;
                        for (let attempt = 0; attempt < 5; attempt++) {
                            const picked = await resolveTokenFromRequest({ 'X-Token-Node': node });
                            try {
                                const files: any = {};
                                if (filesPayload?.first_b64) {
                                    files.first = { filepath: '', originalFilename: 'first.png', buffer: Buffer.from(filesPayload.first_b64, 'base64') };
                                }
                                if (filesPayload?.last_b64) {
                                    files.last = { filepath: '', originalFilename: 'last.png', buffer: Buffer.from(filesPayload.last_b64, 'base64') };
                                }
                                const url = await generateVideo(
                                    model,
                                    prompt,
                                    {
                                        ratio,
                                        resolution,
                                        duration: finalDuration,
                                        filePaths: finalFilePaths,
                                        files,
                                        httpRequest: { body: payload, files },
                                        functionMode,
                                    },
                                    picked.token
                                );
                                if (response_format === 'b64_json') {
                                    const b64 = await util.fetchFileBASE64(url);
                                    return { created: util.unixTimestamp(), data: [{ b64_json: b64, revised_prompt: prompt }] };
                                }
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

                return { created: util.unixTimestamp(), task_id: task.id, status: 'processing' };
            }

            // 验证 duration（根据模型）
            if (!_.isUndefined(request.body.duration)) {
                const modelName = request.body.model || DEFAULT_MODEL;
                let durationValue: number;
                if (isMultiPart && typeof request.body.duration === 'string') {
                    durationValue = parseInt(request.body.duration, 10);
                    // 严格检查 parseInt 结果
                    if (!Number.isInteger(durationValue) || request.body.duration.trim() !== String(durationValue)) {
                        throw new Error(`duration 必须是整数，当前值: ${request.body.duration}`);
                    }
                } else if (_.isFinite(request.body.duration)) {
                    durationValue = request.body.duration as number;
                    if (!Number.isInteger(durationValue)) {
                        throw new Error(`duration 必须是整数，当前值: ${durationValue}`);
                    }
                } else {
                    throw new Error(`duration 参数格式错误`);
                }

                // 根据模型验证 duration 有效值
                let validDurations: number[] = [];
                let errorMessage = '';

                if (modelName.includes('veo3.1') || modelName.includes('veo3')) {
                    validDurations = [8];
                    errorMessage = 'veo3 模型仅支持 8 秒时长';
                } else if (modelName.includes('sora2')) {
                    validDurations = [4, 8, 12];
                    errorMessage = 'sora2 模型仅支持 4、8、12 秒时长';
                } else if (modelName.includes('3.5-pro') || modelName.includes('3.5_pro')) {
                    validDurations = [5, 10, 12];
                    errorMessage = '3.5-pro 模型仅支持 5、10、12 秒时长';
                } else if (modelName.includes('seedance-2.0') || modelName.includes('40_pro') || modelName.includes('40-pro') || modelName.includes('seedance-2.0-fast')) {
                    // seedance 2.0 和 2.0-fast 支持 4~15 秒任意整数
                    if (durationValue < 4 || durationValue > 15) {
                        throw new Error(`seedance 2.0/2.0-fast 模型支持 4~15 秒时长，当前值: ${durationValue}`);
                    }
                } else {
                    // 其他模型支持 5 或 10 秒
                    validDurations = [5, 10];
                    errorMessage = '该模型仅支持 5、10 秒时长';
                }

                // 检查是否在有效值列表中
                if (validDurations.length > 0 && !validDurations.includes(durationValue)) {
                    throw new Error(`${errorMessage}，当前值: ${durationValue}`);
                }
            }

            // 验证 file_paths 和 filePaths
            request
                .validate('body.file_paths', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 2))
                .validate('body.filePaths', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 2));

            if (isOmniMode) {
                // 全能模式验证逻辑
                const uploadedFiles = request.files || {};

                // 统计各类型文件数量
                let imageCount = 0;
                let videoCount = 0;

                // 统计上传的文件
                for (const fieldName of Object.keys(uploadedFiles)) {
                    if (fieldName.startsWith('image_file_')) imageCount++;
                    else if (fieldName.startsWith('video_file_')) videoCount++;
                }

                // 统计URL字段
                for (let i = 1; i <= 9; i++) {
                    const fieldName = `image_file_${i}`;
                    if (typeof request.body[fieldName] === 'string' && request.body[fieldName].startsWith('http')) {
                        imageCount++;
                    }
                }
                for (let i = 1; i <= 3; i++) {
                    const fieldName = `video_file_${i}`;
                    if (typeof request.body[fieldName] === 'string' && request.body[fieldName].startsWith('http')) {
                        videoCount++;
                    }
                }

                // 验证数量限制
                if (imageCount > 9) {
                    throw new Error('全能模式最多上传9张图片');
                }
                if (videoCount > 3) {
                    throw new Error('全能模式最多上传3个视频');
                }

                const totalCount = imageCount + videoCount;
                if (totalCount > 12) {
                    throw new Error('全能模式图片+视频总数不超过12个');
                }
                if (totalCount === 0) {
                    const hasFilePaths = (request.body.filePaths?.length > 0) || (request.body.file_paths?.length > 0);
                    if (!hasFilePaths) {
                        throw new Error('全能模式至少需要上传1个素材文件(图片或视频)');
                    }
                }
            } else {
                // 普通模式验证逻辑（保持原有逻辑）
                const uploadedFiles = request.files ? _.values(request.files) : [];
                if (uploadedFiles.length > 2) {
                    throw new Error('最多只能上传2个图片文件');
                }
            }

            const {
                model = DEFAULT_MODEL,
                prompt,
                ratio = "1:1",
                resolution = "720p",
                duration = 5,
                file_paths = [],
                filePaths = [],
                response_format = "url"
            } = request.body;

            // 如果是 multipart/form-data，需要将字符串转换为数字
            const finalDuration = isMultiPart && typeof duration === 'string'
                ? parseInt(duration)
                : duration;

            // 兼容两种参数名格式：file_paths 和 filePaths
            const finalFilePaths = filePaths.length > 0 ? filePaths : file_paths;

            // Token 池自动重试：1006/登录失效 -> 标记不可用并换下一个 token
            let lastErr: any;
            for (let attempt = 0; attempt < 5; attempt++) {
                const { token, source } = await resolveTokenFromRequest(request.headers);
                try {
                    const generatedVideoUrl = await generateVideo(
                        model,
                        prompt,
                        {
                            ratio,
                            resolution,
                            duration: finalDuration,
                            filePaths: finalFilePaths,
                            files: request.files, // 传递上传的文件
                            httpRequest: request, // 传递完整的 request 对象以访问动态字段
                            functionMode,
                        },
                        token
                    );

                    // 根据response_format返回不同格式的结果
                    if (response_format === "b64_json") {
                        const videoBase64 = await util.fetchFileBASE64(generatedVideoUrl);
                        return {
                            created: util.unixTimestamp(),
                            data: [{
                                b64_json: videoBase64,
                                revised_prompt: prompt
                            }]
                        };
                    }
                    return {
                        created: util.unixTimestamp(),
                        data: [{
                            url: generatedVideoUrl,
                            revised_prompt: prompt
                        }]
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

        '/generations/submit': async (request: Request) => {
            const contentType = request.headers['content-type'] || '';
            const isMultiPart = contentType.startsWith('multipart/form-data');

            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.prompt', _.isString)
                .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
                .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
                .validate('body.functionMode', v => _.isUndefined(v) || (_.isString(v) && ['first_last_frames', 'omni_reference'].includes(v)))
                .validate('body.response_format', v => _.isUndefined(v) || _.isString(v));

            const node = normalizeNode(request.headers?.['x-token-node'] || request.headers?.['X-Token-Node']);

            // 把首帧/尾帧图片在提交时转成 base64（避免后台任务依赖临时文件路径）
            const filesPayload: { first_b64?: string; last_b64?: string } = {};
            if (isMultiPart && request.files) {
                const uploadedFiles = _.values(request.files);
                if (uploadedFiles[0]) {
                    const f: any = uploadedFiles[0];
                    filesPayload.first_b64 = fs.readFileSync(f.filepath).toString('base64');
                }
                if (uploadedFiles[1]) {
                    const f: any = uploadedFiles[1];
                    filesPayload.last_b64 = fs.readFileSync(f.filepath).toString('base64');
                }
            }

            const payload = { ...request.body, isMultiPart, filesPayload };
            const task = await submitTask({
                type: 'video',
                node,
                ttlMs: 8 * 60 * 1000,
                payload: { kind: 'generations', body: payload },
                run: async () => {
                    const { generateVideo } = await import('@/api/controllers/videos.ts');
                    const { resolveTokenFromRequest, markTokenInvalid } = await import('@/lib/token-picker.ts');

                    const {
                        model = DEFAULT_MODEL,
                        prompt,
                        ratio = "1:1",
                        resolution = "720p",
                        duration = 5,
                        file_paths = [],
                        filePaths = [],
                        response_format = "url",
                        functionMode = 'first_last_frames',
                        isMultiPart,
                        filesPayload,
                    } = payload as any;

                    const finalDuration = isMultiPart && typeof duration === 'string' ? parseInt(duration) : duration;
                    const finalFilePaths = filePaths.length > 0 ? filePaths : file_paths;

                    let lastErr: any;
                    for (let attempt = 0; attempt < 5; attempt++) {
                        const picked = await resolveTokenFromRequest({ 'X-Token-Node': node });
                        try {
                            // 为 first_last_frames 提供 files（仅首尾帧）
                            const files: any = {};
                            if (filesPayload?.first_b64) {
                                files.first = { filepath: '', originalFilename: 'first.png', buffer: Buffer.from(filesPayload.first_b64, 'base64') };
                            }
                            if (filesPayload?.last_b64) {
                                files.last = { filepath: '', originalFilename: 'last.png', buffer: Buffer.from(filesPayload.last_b64, 'base64') };
                            }

                            const url = await generateVideo(
                                model,
                                prompt,
                                {
                                    ratio,
                                    resolution,
                                    duration: finalDuration,
                                    filePaths: finalFilePaths,
                                    files,
                                    httpRequest: { body: payload, files },
                                    functionMode,
                                },
                                picked.token
                            );

                            if (response_format === 'b64_json') {
                                const b64 = await util.fetchFileBASE64(url);
                                return { created: util.unixTimestamp(), data: [{ b64_json: b64, revised_prompt: prompt }] };
                            }
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

            return { created: util.unixTimestamp(), task_id: task.id, status: 'processing' };
        }

    }

}
