<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../lib/api'

type RespFormat = 'url' | 'b64_json'

type NodeKey = 'cn' | 'jp' | 'us' | 'hk' | 'sg'

interface ModelItem {
  id: string
  object: string
  owned_by?: string
  description?: string
}

interface ModelsResp {
  data: ModelItem[]
}

interface GenResp {
  created: number
  data: Array<{ url?: string; b64_json?: string }>
}

const loading = ref(false)
const error = ref('')

const node = ref<NodeKey>('cn')

const models = ref<ModelItem[]>([])
const modelsLoading = ref(false)

const model = ref('jimeng-4.5')
const prompt = ref('')
const negative_prompt = ref('')
const ratio = ref('1:1')
const resolution = ref('2k')
const intelligent_ratio = ref(false)
const response_format = ref<RespFormat>('url')

const result = ref<GenResp | null>(null)

const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']
const resolutions = ['1k', '2k', '4k']

const modelOptions = computed(() => {
  const list = models.value
    .map((m) => m.id)
    .filter((id) => typeof id === 'string' && id.length > 0)
  // 去重
  return Array.from(new Set(list))
})

async function loadModels() {
  modelsLoading.value = true
  try {
    const r = await apiFetch<ModelsResp>('/v1/models', { method: 'GET' })
    models.value = r.data || []
    // 如果当前 model 不在列表里，就保持不变（避免覆盖用户输入）
  } catch (e: any) {
    // 模型列表失败不影响生成（仍可手填）
  } finally {
    modelsLoading.value = false
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
    // 注意：不带 Authorization，让后端自动从 Token 池抽取
    // 通过 X-Token-Node 指定节点（cn/jp/us/hk/sg）
    const body: any = {
      model: model.value,
      prompt: prompt.value,
      response_format: response_format.value,
    }
    if (negative_prompt.value.trim()) body.negative_prompt = negative_prompt.value
    if (ratio.value) body.ratio = ratio.value
    if (resolution.value) body.resolution = resolution.value
    if (intelligent_ratio.value) body.intelligent_ratio = true

    const r = await apiFetch<GenResp>('/v1/images/generations', {
      method: 'POST',
      headers: {
        'X-Token-Node': node.value,
      },
      body: JSON.stringify(body),
    })
    result.value = r
  } catch (e: any) {
    error.value = e?.message || '生成失败'
  } finally {
    loading.value = false
  }
}

function b64ToDataUrl(b64: string) {
  if (!b64) return ''
  return `data:image/png;base64,${b64}`
}

onMounted(() => {
  loadModels()
})
</script>

<template>
  <div class="wrap">
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
            <span>模型</span>
            <div class="row2">
              <select v-if="modelOptions.length" v-model="model" :disabled="modelsLoading">
                <option v-for="id in modelOptions" :key="id" :value="id">{{ id }}</option>
              </select>
              <input v-else v-model="model" placeholder="jimeng-4.5" />
              <button class="btn ghost" type="button" @click="loadModels" :disabled="modelsLoading">
                {{ modelsLoading ? '加载中…' : '刷新模型' }}
              </button>
            </div>
            <div class="hint">模型列表来自 GET /v1/models；如未覆盖到你想用的模型，可直接手填。</div>
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

          <button class="btn" @click="generate" :disabled="loading">
            {{ loading ? '生成中…' : '生成图片' }}
          </button>

          <div v-if="error" class="error">{{ error }}</div>
        </div>
      </div>

      <div class="card">
        <div class="h">结果</div>
        <div v-if="!result" class="hint">提交后在这里展示结果（url 或 base64）。</div>

        <div v-else class="result">
          <div class="mono">created: {{ result.created }}</div>

          <div class="imgs">
            <template v-for="(item, idx) in result.data" :key="idx">
              <div class="imgCard">
                <div v-if="item.url" class="mono">
                  <a :href="item.url" target="_blank" rel="noreferrer">{{ item.url }}</a>
                </div>
                <img v-if="item.url" :src="item.url" />

                <div v-else-if="item.b64_json" class="mono">base64 返回（已在下方预览）</div>
                <img v-else-if="item.b64_json" :src="b64ToDataUrl(item.b64_json)" />
              </div>
            </template>
          </div>

          <details class="raw">
            <summary>原始 JSON</summary>
            <pre class="mono">{{ JSON.stringify(result, null, 2) }}</pre>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  background: #0b1020;
  color: rgba(255, 255, 255, 0.9);
  padding: 22px;
}

.topbar {
  max-width: 1200px;
  margin: 0 auto 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title {
  font-weight: 800;
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
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 980px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.card {
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 16px;
}

.h {
  font-weight: 800;
  margin-bottom: 10px;
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

input,
select {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  outline: none;
}

.ta {
  min-height: 96px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  outline: none;
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

.btn {
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(34, 197, 94, 0.9));
  color: #fff;
  font-weight: 800;
  cursor: pointer;
}

.btn.ghost {
  background: rgba(255, 255, 255, 0.06);
  font-weight: 600;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.28);
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
}

.result {
  display: grid;
  gap: 10px;
}

.imgs {
  display: grid;
  grid-template-columns: 1fr;
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

pre.mono,
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  word-break: break-all;
  white-space: pre-wrap;
}

a {
  color: rgba(147, 197, 253, 0.95);
}
</style>
