<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { apiFetch } from '../lib/api'
import { IMAGE_MODELS_BY_NODE, type NodeKey } from '../lib/models-map'

type RespFormat = 'url' | 'b64_json'

interface GenResp {
  created: number
  data: Array<{ url?: string; b64_json?: string }>
}

const loading = ref(false)
const error = ref('')

const node = ref<NodeKey>('jp')

// 仅用于提示/兼容：仍然拉一次 /v1/models（失败不影响）
const modelsLoading = ref(false)

const model = ref('jimeng-4.5')
const prompt = ref('')
const negative_prompt = ref('')
const ratio = ref('1:1')
const resolution = ref('2k')
const intelligent_ratio = ref(false)
const response_format = ref<RespFormat>('url')

// 参考图片：本地文件 + URL
const refImagesFiles = ref<File[]>([])
const refImagesUrls = ref('')

const result = ref<GenResp | any | null>(null)

const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']
const resolutions = computed(() => {
  // README 规则：nanobanana 在 US 固定 1024x1024 + 2k（忽略 ratio/resolution）
  // HK/JP/SG 强制 1k
  // 这里先做 UI 限制，最终仍以服务端行为为准。
  if (model.value === 'nanobanana') {
    if (node.value === 'us') return ['2k']
    if (node.value === 'hk' || node.value === 'jp' || node.value === 'sg') return ['1k']
  }
  return ['1k', '2k', '4k']
})

const modelOptions = computed(() => IMAGE_MODELS_BY_NODE[node.value] || [])

const imageItems = computed(() => {
  const r: any = result.value
  if (!r) return []
  if (Array.isArray(r)) return r
  if (Array.isArray(r.data)) return r.data
  return []
})

const createdValue = computed(() => {
  const r: any = result.value
  if (r && !Array.isArray(r) && typeof r.created === 'number') {
    return r.created
  }
  return null
})

async function loadModelsHint() {
  modelsLoading.value = true
  try {
    await apiFetch('/v1/models', { method: 'GET' })
  } catch {
    // ignore
  } finally {
    modelsLoading.value = false
  }
}

function ensureModelInNode() {
  if (!modelOptions.value.includes(model.value)) {
    model.value = modelOptions.value[0] || 'jimeng-4.5'
  }
}

async function generate() {
  error.value = ''
  result.value = null
  if (!prompt.value.trim()) {
    error.value = '请输入 prompt'
    return
  }

  loading.value = true
  try {
    // 不带 Authorization，让后端自动从 Token 池抽取
    // 通过 X-Token-Node 指定节点（cn/jp/us/hk/sg）

    // 解析参考图片（本地 + URL）
    const hasRefFiles = refImagesFiles.value.length > 0
    const urlLines = (refImagesUrls.value || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const hasRefUrls = urlLines.length > 0

    if (!hasRefFiles && !hasRefUrls) {
      // 纯文生图：同步标准接口
      const body: any = {
        model: model.value,
        prompt: prompt.value,
        response_format: response_format.value,
      }
      if (negative_prompt.value.trim()) body.negative_prompt = negative_prompt.value
      if (ratio.value) body.ratio = ratio.value
      if (resolution.value) body.resolution = resolution.value
      if (intelligent_ratio.value) body.intelligent_ratio = true

      const r = await apiFetch<any>('/v1/images/generations', {
        method: 'POST',
        headers: {
          'X-Token-Node': node.value,
        },
        body: JSON.stringify(body),
      })
      result.value = r
      return
    }

    // 图生图：同步 /compositions
    // 1) 有本地文件时使用 multipart/form-data
    if (hasRefFiles) {
      const fd = new FormData()
      fd.append('model', model.value)
      fd.append('prompt', prompt.value)
      if (negative_prompt.value.trim()) fd.append('negative_prompt', negative_prompt.value)
      if (ratio.value) fd.append('ratio', ratio.value)
      if (resolution.value) fd.append('resolution', resolution.value)
      if (intelligent_ratio.value) fd.append('intelligent_ratio', 'true')
      // sample_strength 使用后端默认 0.5，这里先不暴露

      // images 字段：支持多张
      refImagesFiles.value.forEach((file) => {
        fd.append('images', file)
      })

      const r = await apiFetch<any>('/v1/images/compositions', {
        method: 'POST',
        headers: {
          'X-Token-Node': node.value,
        },
        body: fd,
      })
      result.value = r
      return
    }

    // 2) 只有 URL 时，使用 JSON 形式的 images 数组
    const body: any = {
      model: model.value,
      prompt: prompt.value,
      images: urlLines,
      response_format: response_format.value,
    }
    if (negative_prompt.value.trim()) body.negative_prompt = negative_prompt.value
    if (ratio.value) body.ratio = ratio.value
    if (resolution.value) body.resolution = resolution.value
    if (intelligent_ratio.value) body.intelligent_ratio = true

    const r = await apiFetch<any>('/v1/images/compositions', {
      method: 'POST',
      headers: {
        'X-Token-Node': node.value,
      },
      body: JSON.stringify(body),
    })
    result.value = r
  } catch (e: any) {
    // 你遇到的：[登录失效]: check login error
    error.value = e?.message || '生成失败'
  } finally {
    loading.value = false
  }
}

function b64ToDataUrl(b64: string) {
  if (!b64) return ''
  return `data:image/png;base64,${b64}`
}

function onRefImagesChange(e: Event) {
  const input = e.target as HTMLInputElement | null
  const files = Array.from(input?.files || [])
  refImagesFiles.value = files
}

onMounted(() => {
  loadModelsHint()
  ensureModelInNode()
})

onUnmounted(() => {
  // sync mode: no polling
})

watch(node, () => {
  // 节点变更后强制把模型限定在该节点支持列表
  ensureModelInNode()
})
</script>

<template>
  <div class="page">
    <div class="topbar">
      <div>
        <div class="title">图片生成控制台</div>
        <div class="meta">自动从 Token 池抽取（无需填写 Authorization）</div>
      </div>

      <div class="node">
        <span class="lbl">生成节点</span>
        <select v-model="node">
          <option value="cn">国内（CN）</option>
          <option value="jp">日本（JP）</option>
          <option value="us">美国（US）</option>
          <option value="hk">香港（HK）</option>
          <option value="sg">新加坡（SG）</option>
        </select>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="h">参数</div>

        <div class="form">
          <label class="field">
            <span>模型（与节点联动）</span>
            <div class="row2">
              <select v-model="model" :disabled="modelsLoading">
                <option v-for="id in modelOptions" :key="id" :value="id">{{ id }}</option>
              </select>
              <button class="btn ghost" type="button" @click="loadModelsHint" :disabled="modelsLoading">
                {{ modelsLoading ? '…' : '刷新' }}
              </button>
            </div>
            <div class="hint">模型范围来自 README.CN.md 的节点/模型关系；后端仍会做最终校验。</div>
          </label>

          <label class="field">
            <span>Prompt</span>
            <textarea v-model="prompt" class="ta" placeholder="描述你想生成的内容…"></textarea>
          </label>

          <label class="field">
            <span>Negative Prompt（可选）</span>
            <textarea v-model="negative_prompt" class="ta" placeholder="不希望出现的内容…"></textarea>
          </label>

          <div class="row">
            <label class="field">
              <span>Ratio</span>
              <select v-model="ratio">
                <option v-for="r in ratios" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>

            <label class="field">
              <span>Resolution</span>
              <select v-model="resolution">
                <option v-for="x in resolutions" :key="x" :value="x">{{ x }}</option>
              </select>
            </label>

            <label class="field">
              <span>Response</span>
              <select v-model="response_format">
                <option value="url">url</option>
                <option value="b64_json">b64_json</option>
              </select>
            </label>
          </div>

          <label class="chk">
            <input type="checkbox" v-model="intelligent_ratio" />
            <span>intelligent_ratio（仅部分模型有效）</span>
          </label>

          <div class="ref-block">
            <div class="ref-title">参考图片（可选，仅部分模型支持图生图）</div>
            <div class="ref-row">
              <span class="lbl">本地图片</span>
              <input type="file" multiple accept="image/*" @change="onRefImagesChange" />
            </div>
            <div class="ref-row">
              <span class="lbl">图片 URL</span>
              <textarea
                v-model="refImagesUrls"
                class="ta small"
                placeholder="每行一条图片 URL；如同时上传本地图片，则以本地图片为准"
              />
            </div>
          </div>

          <button class="btn" @click="generate" :disabled="loading">
            {{ loading ? '生成中…' : '生成图片' }}
          </button>

          <div v-if="error" class="error">{{ error }}</div>
        </div>
      </div>

      <div class="card">
        <div class="h">结果</div>
        <div v-if="!result" class="p">提交后在这里展示结果（url 或 base64）。</div>

        <div v-else class="result">
          <div v-if="createdValue !== null" class="mono">created: {{ createdValue }}</div>

          <div class="imgs" v-if="imageItems.length">
            <template v-for="(item, idx) in imageItems" :key="idx">
              <div class="imgCard">
                <img v-if="item.url" :src="item.url" />

                <div v-else-if="item.b64_json" class="mono">base64 返回（已在下方预览）</div>
                <img v-else-if="item.b64_json" :src="b64ToDataUrl(item.b64_json)" />
              </div>
            </template>
          </div>

          <div v-else class="p">未返回任何图片数据（data 为空），请查看下方原始返回。</div>

          <details class="raw">
            <summary>原始 JSON</summary>
            <pre class="mono">{{ JSON.stringify(result, null, 2) }}</pre>
          </details>
        </div>

        <!-- 同步模式：无需显示 task_id -->
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 14px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title {
  font-weight: 900;
}

.meta {
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  margin-top: 2px;
}

.node {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lbl {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 980px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.form {
  display: grid;
  gap: 12px;
}

.field {
  display: grid;
  gap: 8px;
}

.field > span {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

.ta {
  min-height: 96px;
  padding: 10px 12px;
  resize: vertical;
}

.hint {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}

.row2 {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}

.chk {
  display: flex;
  gap: 10px;
  align-items: center;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

.ref-block {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.15);
  display: grid;
  gap: 8px;
}

.ref-title {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
}

.ref-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 8px;
  align-items: center;
}

.ta.small {
  min-height: 64px;
}

.result {
  display: grid;
  gap: 10px;
}

.imgs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.imgCard {
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.22);
  padding: 12px;
}

.imgCard img {
  margin-top: 10px;
  width: 100%;
  border-radius: 12px;
  display: block;
}

.raw {
  margin-top: 8px;
}
</style>
