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
