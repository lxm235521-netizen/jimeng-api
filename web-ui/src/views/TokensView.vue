<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../lib/api'

interface TokenRecord {
  id: string
  token_value: string
  status: 'valid' | 'invalid'
  created_at: string
  updated_at: string
}

const loading = ref(false)
const error = ref('')
const tokens = ref<TokenRecord[]>([])

const showImport = ref(false)
const importText = ref('')
const importing = ref(false)
const importResult = ref<string>('')

const addOneText = ref('')
const adding = ref(false)

const validCount = computed(() => tokens.value.filter((t) => t.status === 'valid').length)

function maskToken(v: string) {
  if (!v) return ''
  if (v.length <= 18) return v
  return `${v.slice(0, 10)}…${v.slice(-6)}`
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const data = await apiFetch<{ tokens: TokenRecord[] }>('/api/admin/tokens', { method: 'GET' })
    tokens.value = data.tokens || []
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function addOne() {
  const v = addOneText.value.trim()
  if (!v) return
  adding.value = true
  error.value = ''
  try {
    await apiFetch('/api/admin/tokens', { method: 'POST', body: JSON.stringify({ token_value: v }) })
    addOneText.value = ''
    await loadList()
  } catch (e: any) {
    error.value = e?.message || '新增失败'
  } finally {
    adding.value = false
  }
}

async function doImport() {
  importing.value = true
  error.value = ''
  importResult.value = ''
  try {
    const r = await apiFetch<{ inserted: number; skipped: number; totalLines: number; totalTokens: number }>(
      '/api/admin/tokens/import',
      {
        method: 'POST',
        body: JSON.stringify({ text: importText.value }),
      },
    )
    importResult.value = `导入完成：插入 ${r.inserted}，跳过 ${r.skipped}（行数 ${r.totalLines} / token数 ${r.totalTokens}）`
    importText.value = ''
    await loadList()
  } catch (e: any) {
    error.value = e?.message || '导入失败'
  } finally {
    importing.value = false
  }
}

async function del(id: string) {
  if (!confirm('确定删除该 Token？')) return
  error.value = ''
  try {
    await apiFetch(`/api/admin/tokens/${id}`, { method: 'DELETE' })
    await loadList()
  } catch (e: any) {
    error.value = e?.message || '删除失败'
  }
}

onMounted(() => {
  loadList()
})
</script>

<template>
  <div class="wrap">
    <div class="topbar">
      <div class="title">Token 池管理</div>
      <div class="meta">共 {{ tokens.length }} 个 / 有效 {{ validCount }} 个</div>
      <div class="sp"></div>
      <button class="btn" @click="showImport = true">批量导入</button>
      <button class="btn ghost" @click="loadList" :disabled="loading">刷新</button>
    </div>

    <div class="card">
      <div class="row">
        <input class="input" v-model="addOneText" placeholder="新增单个 token（可包含 us-/hk- 前缀的完整 sessionid）" />
        <button class="btn" @click="addOne" :disabled="adding || !addOneText.trim()">{{ adding ? '提交中…' : '新增' }}</button>
      </div>

      <div v-if="error" class="error">{{ error }}</div>

      <div class="table">
        <div class="tr th">
          <div>ID</div>
          <div>Token</div>
          <div>Status</div>
          <div>Updated</div>
          <div>Created</div>
          <div></div>
        </div>

        <div v-if="loading" class="empty">加载中…</div>
        <div v-else-if="tokens.length === 0" class="empty">暂无 Token，点击“批量导入”或上方新增。</div>

        <div v-else class="tbody">
          <div v-for="t in tokens" :key="t.id" class="tr">
            <div class="mono">{{ t.id.slice(0, 8) }}</div>
            <div class="mono" :title="t.token_value">{{ maskToken(t.token_value) }}</div>
            <div>
              <span class="tag" :class="t.status">{{ t.status }}</span>
            </div>
            <div class="mono">{{ t.updated_at }}</div>
            <div class="mono">{{ t.created_at }}</div>
            <div class="ops">
              <button class="btn danger" @click="del(t.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showImport" class="modal">
      <div class="dialog">
        <div class="h">批量导入</div>
        <div class="p">按换行分割；会自动过滤空行；支持一行多个 token（用英文逗号分隔）。</div>
        <textarea class="ta" v-model="importText" placeholder="在这里粘贴多个 token，每行一个…"></textarea>
        <div v-if="importResult" class="ok">{{ importResult }}</div>
        <div class="actions">
          <button class="btn ghost" @click="showImport = false">取消</button>
          <button class="btn" @click="doImport" :disabled="importing || !importText.trim()">
            {{ importing ? '导入中…' : '提交导入' }}
          </button>
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
  gap: 10px;
}

.title {
  font-weight: 800;
}

.meta {
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
}

.sp {
  flex: 1;
}

.card {
  max-width: 1200px;
  margin: 0 auto;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 16px;
}

.row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  outline: none;
}

.btn {
  border-radius: 12px;
  padding: 9px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(34, 197, 94, 0.9));
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.btn.ghost {
  background: rgba(255, 255, 255, 0.06);
  font-weight: 600;
}

.btn.danger {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.35);
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
  margin-bottom: 10px;
}

.table {
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  overflow: hidden;
}

.tr {
  display: grid;
  grid-template-columns: 90px 1fr 90px 220px 220px 90px;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  align-items: center;
}

.th {
  border-top: none;
  background: rgba(0, 0, 0, 0.22);
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  word-break: break-all;
}

.ops {
  display: flex;
  justify-content: flex-end;
}

.tag {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.tag.valid {
  color: rgba(34, 197, 94, 0.95);
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.25);
}

.tag.invalid {
  color: rgba(239, 68, 68, 0.95);
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.25);
}

.empty {
  padding: 20px;
  color: rgba(255, 255, 255, 0.55);
}

.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 16px;
}

.dialog {
  width: 100%;
  max-width: 720px;
  border-radius: 16px;
  background: #0f1730;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 16px;
}

.h {
  font-weight: 800;
  margin-bottom: 6px;
}

.p {
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  margin-bottom: 10px;
}

.ta {
  width: 100%;
  min-height: 240px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  padding: 10px 12px;
  outline: none;
  resize: vertical;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}

.ok {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.22);
  color: rgba(187, 247, 208, 0.95);
  font-size: 13px;
}
</style>
