<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { apiFetch } from '../lib/api'
import { VIDEO_MODELS_BY_NODE, type NodeKey } from '../lib/models-map'

type RespFormat = 'url' | 'b64_json'

interface GenResp {
  created: number
  data: Array<{ url?: string; b64_json?: string }>
}

const loading = ref(false)
const error = ref('')

const node = ref<NodeKey>('cn')
const model = ref('jimeng-video-3.0')
const prompt = ref('')
const ratio = ref('1:1')
const resolution = ref('720p')
const duration = ref(5)
const response_format = ref<RespFormat>('url')

// 参考帧：首帧 / 尾帧图片
const firstFrameFile = ref<File | null>(null)
const lastFrameFile = ref<File | null>(null)

const result = ref<GenResp | any | null>(null)

const ratios = ['1:1', '16:9', '9:16']
const resolutions = ['720p', '1080p']
const durations = computed(() => {
  // 简单前端校验：大部分模型支持 5 / 10 秒；特殊限制仍交由后端严格校验
  return [5, 10, 12]
})

const modelOptions = computed(() => VIDEO_MODELS_BY_NODE[node.value] || [])

const videoItems = computed(() => {
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

function ensureModelInNode() {
  if (!modelOptions.value.includes(model.value)) {
    model.value = modelOptions.value[0] || 'jimeng-video-3.0'
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
    const hasFirst = !!firstFrameFile.value
    const hasLast = !!lastFrameFile.value

    if (!hasFirst && !hasLast) {
      // 纯文本视频生成：同步标准接口
      const body: any = {
        model: model.value,
        prompt: prompt.value,
        ratio: ratio.value,
        resolution: resolution.value,
        duration: duration.value,
        response_format: response_format.value,
        functionMode: 'first_last_frames',
      }

      const r = await apiFetch<any>('/v1/videos/generations', {
        method: 'POST',
        headers: {
          'X-Token-Node': node.value,
        },
        body: JSON.stringify(body),
      })
      result.value = r
      return
    }

    // 带首帧/尾帧图片的视频：multipart/form-data（同步标准接口）
    const fd = new FormData()
    fd.append('model', model.value)
    fd.append('prompt', prompt.value)
    fd.append('ratio', ratio.value)
    fd.append('resolution', resolution.value)
    fd.append('duration', String(duration.value))
    fd.append('response_format', response_format.value)
    fd.append('functionMode', 'first_last_frames')

    if (firstFrameFile.value) {
      fd.append('image_file_1', firstFrameFile.value)
    }
    if (lastFrameFile.value) {
      fd.append('image_file_2', lastFrameFile.value)
    }

    const r = await apiFetch<any>('/v1/videos/generations', {
      method: 'POST',
      headers: {
        'X-Token-Node': node.value,
      },
      body: fd,
    })
    result.value = r
  } catch (e: any) {
    error.value = e?.message || '生成失败'
  } finally {
    loading.value = false
  }
}

function b64ToVideoUrl(b64: string) {
  if (!b64) return ''
  return `data:video/mp4;base64,${b64}`
}

function onFirstFrameChange(e: Event) {
  const input = e.target as HTMLInputElement | null
  const file = (input?.files && input.files[0]) || null
  firstFrameFile.value = file
}

function onLastFrameChange(e: Event) {
  const input = e.target as HTMLInputElement | null
  const file = (input?.files && input.files[0]) || null
  lastFrameFile.value = file
}

onUnmounted(() => {
  // sync mode: no polling
})
</script>

<template>
  <div class="page">
    <div class="topbar">
      <div>
        <div class="title">视频生成控制台</div>
        <div class="meta">自动从 Token 池抽取（无需填写 Authorization）</div>
      </div>

      <div class="node">
        <span class="lbl">生成节点</span>
        <select v-model="node" @change="ensureModelInNode">
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
            <select v-model="model">
              <option v-for="id in modelOptions" :key="id" :value="id">
                {{ id }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>Prompt</span>
            <textarea v-model="prompt" class="ta" placeholder="描述你想生成的视频内容…"></textarea>
          </label>

          <div class="row">
            <label class="field">
              <span>Ratio</span>
              <select v-model="ratio">
                <option v-for="r in ratios" :key="r" :value="r">
                  {{ r }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>Resolution</span>
              <select v-model="resolution">
                <option v-for="x in resolutions" :key="x" :value="x">
                  {{ x }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>Duration（秒）</span>
              <select v-model.number="duration">
                <option v-for="d in durations" :key="d" :value="d">
                  {{ d }}
                </option>
              </select>
            </label>
          </div>

          <label class="field">
            <span>Response</span>
            <select v-model="response_format">
              <option value="url">url</option>
              <option value="b64_json">b64_json</option>
            </select>
          </label>

          <div class="ref-block">
            <div class="ref-title">参考帧（可选，仅首尾帧模式）</div>
            <div class="ref-row">
              <span class="lbl">首帧图片</span>
              <input type="file" accept="image/*" @change="onFirstFrameChange" />
            </div>
            <div class="ref-row">
              <span class="lbl">尾帧图片</span>
              <input type="file" accept="image/*" @change="onLastFrameChange" />
            </div>
          </div>

          <button class="btn" @click="generate" :disabled="loading">
            {{ loading ? '生成中…' : '生成视频' }}
          </button>

          <div v-if="error" class="error">{{ error }}</div>
        </div>
      </div>

      <div class="card">
        <div class="h">结果</div>
        <div v-if="!result" class="p">提交后在这里展示视频结果（url 或 base64）。</div>

        <div v-else class="result">
          <div v-if="createdValue !== null" class="mono">created: {{ createdValue }}</div>

          <div class="videos" v-if="videoItems.length">
            <template v-for="(item, idx) in videoItems" :key="idx">
              <div class="videoCard">
                <template v-if="item.url || item.b64_json">
                  <video v-if="item.url" class="player" controls :src="item.url"></video>
                  <video v-else-if="item.b64_json" class="player" controls :src="b64ToVideoUrl(item.b64_json)"></video>
                </template>

                <div v-else class="mono">未返回可用的视频 URL 或 base64，请查看下方原始返回。</div>
              </div>
            </template>
          </div>

          <div v-else class="mono">未返回任何视频数据（data 为空），请查看下方原始返回。</div>

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

.row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}

.result {
  display: grid;
  gap: 10px;
}

.videos {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.videoCard {
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.22);
  padding: 12px;
}

.player {
  margin-top: 10px;
  width: 100%;
  border-radius: 12px;
  display: block;
}

.raw {
  margin-top: 8px;
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
</style>

