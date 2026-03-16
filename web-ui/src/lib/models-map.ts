export type NodeKey = 'cn' | 'us' | 'jp' | 'hk' | 'sg'

// 来自 README.CN.md（图片模型支持范围）
export const IMAGE_MODELS_BY_NODE: Record<NodeKey, string[]> = {
  cn: [
    'jimeng-5.0',
    'jimeng-4.6',
    'jimeng-4.5',
    'jimeng-4.1',
    'jimeng-4.0',
    'jimeng-3.1',
    'jimeng-3.0',
  ],
  // 国际站：README 表述“jimeng-5.0/4.6”仅亚洲国际站支持（HK/JP/SG）
  us: ['nanobanana', 'nanobananapro', 'jimeng-4.5', 'jimeng-4.1', 'jimeng-4.0', 'jimeng-3.0'],
  hk: ['nanobanana', 'nanobananapro', 'jimeng-5.0', 'jimeng-4.6', 'jimeng-4.5', 'jimeng-4.1', 'jimeng-4.0', 'jimeng-3.0'],
  jp: ['nanobanana', 'nanobananapro', 'jimeng-5.0', 'jimeng-4.6', 'jimeng-4.5', 'jimeng-4.1', 'jimeng-4.0', 'jimeng-3.0'],
  sg: ['nanobanana', 'nanobananapro', 'jimeng-5.0', 'jimeng-4.6', 'jimeng-4.5', 'jimeng-4.1', 'jimeng-4.0', 'jimeng-3.0'],
}

// 视频模型（与后端 VIDEO_MODEL_MAP* 对应）
export const VIDEO_MODELS_BY_NODE: Record<NodeKey, string[]> = {
  cn: [
    'jimeng-video-seedance-2.0',
    'jimeng-video-seedance-2.0-fast',
    'jimeng-video-3.5-pro',
    'jimeng-video-3.0-pro',
    'jimeng-video-3.0',
    'jimeng-video-3.0-fast',
    'jimeng-video-2.0',
    'jimeng-video-2.0-pro',
  ],
  us: [
    'jimeng-video-3.5-pro',
    'jimeng-video-3.0',
  ],
  hk: [
    'jimeng-video-veo3',
    'jimeng-video-veo3.1',
    'jimeng-video-sora2',
    'jimeng-video-3.5-pro',
    'jimeng-video-3.0-pro',
    'jimeng-video-3.0',
    'jimeng-video-3.0-fast',
    'jimeng-video-2.0',
    'jimeng-video-2.0-pro',
  ],
  jp: [
    'jimeng-video-veo3',
    'jimeng-video-veo3.1',
    'jimeng-video-sora2',
    'jimeng-video-3.5-pro',
    'jimeng-video-3.0-pro',
    'jimeng-video-3.0',
    'jimeng-video-3.0-fast',
    'jimeng-video-2.0',
    'jimeng-video-2.0-pro',
  ],
  sg: [
    'jimeng-video-veo3',
    'jimeng-video-veo3.1',
    'jimeng-video-sora2',
    'jimeng-video-3.5-pro',
    'jimeng-video-3.0-pro',
    'jimeng-video-3.0',
    'jimeng-video-3.0-fast',
    'jimeng-video-2.0',
    'jimeng-video-2.0-pro',
  ],
}
