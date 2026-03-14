<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../lib/api'

type NodeKey = 'cn' | 'jp' | 'us' | 'hk' | 'sg'

interface TokenRecord {
  id: string
  token_value: string
  status: 'valid' | 'invalid'
  node?: NodeKey
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

const checking = ref(false)
const checkResult = ref<string>('')

const importNode = ref<NodeKey>('cn')
const filterNode = ref<NodeKey | 'all'>('all')

const validCount = computed(() => tokens.value.filter((t) => t.status === 'valid').length)

function maskToken(v: string) {
  if (!v) return ''
  // 不显示完整 token，避免泄露（仍可复制/导出时再做）
  if (v.length <= 18) return v
  return `${v.slice(0, 10)}…${v.slice(-6)}`
}

function prefixForNode(n: NodeKey) {
  if (n === 'cn') return ''
  return `${n}-`
}

function normalizeInputLine(line: string, node: NodeKey) {
  let s = (line || '').trim()
  if (!s) return ''
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '').trim()

  // 如果用户已经写了 us-/jp-/hk-/sg-，就不再重复加
  if (/^(us|jp|hk|sg)-/i.test(s) || node === 'cn') return s

  return `${prefixForNode(node)}${s}`
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const qs = filterNode.value === 'all' ? '' : `?node=${filterNode.value}`
    const data = await apiFetch<{ tokens: TokenRecord[] }>(`/api/admin/tokens${qs}`, { method: 'GET' })
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
    const lines = (importText.value || '').split(/\r?\n/)
    const normalized = lines
      .map((l) => normalizeInputLine(l, importNode.value))
      .filter((l) => l.length > 0)
      .join('\n')

    const r = await apiFetch<{ inserted: number; skipped: number; totalLines: number; totalTokens: number }>(
      '/api/admin/tokens/import',
      {
        method: 'POST',
        body: JSON.stringify({ text: normalized }),
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

async function runCheck() {
  checking.value = true
  error.value = ''
  checkResult.value = ''
  try {
    const r = await apiFetch<{ total: number; checked: number; invalidated: number; unknown?: number }>(
      '/api/admin/tokens/healthcheck',
      { method: 'POST' },
    )
    checkResult.value = `检测完成：检查 ${r.checked}/${r.total}，失效标记 ${r.invalidated}${typeof r.unknown === 'number' ? `，未知 ${r.unknown}` : ''}`
    await loadList()
  } catch (e: any) {
    error.value = e?.message || '检测失败'
  } finally {
    checking.value = false
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
  <div class="page">
    <div class="topbar">
      <div>
        <div class="title">Token 池管理</div>
        <div class="meta">共 {{ tokens.length }} 个 / 有效 {{ validCount }} 个</div>
      </div>

      <div class="sp"></div>

      <div class="filters">
        <span class="lbl">筛选节点</span>
        <select v-model="filterNode" @change="loadList">
          <option value="all">全部</option>
          <option value="cn">国内（CN）</option>
          <option value="jp">日本（JP）</option>
          <option value="us">美国（US）</option>
          <option value="hk">香港（HK）</option>
          <option value="sg">新加坡（SG）</option>
        </select>
      </div>

      <button class="btn ghost" @click="runCheck" :disabled="checking">
        {{ checking ? '检测中…' : '立即检测' }}
      </button>
      <button class="btn" @click="showImport = true">批量导入</button>
      <button class="btn ghost" @click="loadList" :disabled="loading">刷新</button>
    </div>

    <div class="card">
      <div class="row">
        <input class="input" v-model="addOneText" placeholder="新增单个 token（可包含 us-/jp-/hk-/sg- 前缀的完整 sessionid）" />
        <button class="btn" @click="addOne" :disabled="adding || !addOneText.trim()">{{ adding ? '提交中…' : '新增' }}</button>
      </div>

      <div v-if="checkResult" class="ok">{{ checkResult }}</div>
      <div v-if="error" class="error">{{ error }}</div>

      <div class="table">
        <div class="tr th">
          <div>ID</div>
          <div>Node</div>
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
            <div class="mono">{{ t.node || '-' }}</div>
            <div class="mono" :title="t.token_value">{{ maskToken(t.token_value) }}</div>
            <div>
              <span class="dot" :class="t.status" title="valid=绿 / invalid=红"></span>
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
        <div class="p">选择节点后，会自动给每行 token 补前缀（cn 不加；jp/us/hk/sg 会加）。若你已手写了前缀，则不会重复添加。</div>

        <div class="row" style="margin: 10px 0 6px;">
          <span class="lbl">节点</span>
          <select v-model="importNode">
            <option value="cn">国内（CN）</option>
            <option value="jp">日本（JP）</option>
            <option value="us">美国（US）</option>
            <option value="hk">香港（HK）</option>
            <option value="sg">新加坡（SG）</option>
          </select>
        </div>

        <textarea class="ta" v-model="importText" placeholder="在这里粘贴多个 token，每行一个…"></textarea>
        <div v-if="importResult" class="ok" style="margin-top:10px;">{{ importResult }}</div>
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
.page {
  display: grid;
  gap: 14px;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title {
  font-weight: 900;
}

.meta {
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  margin-top: 2px;
}

.sp {
  flex: 1;
}

.filters {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lbl {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

.row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.input {
  flex: 1;
  padding: 10px 12px;
}

.table {
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  overflow: hidden;
}

.tr {
  display: grid;
  grid-template-columns: 90px 60px 1fr 140px 220px 220px 90px;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  align-items: center;
}

.th {
  border-top: none;
  background: rgba(0, 0, 0, 0.22);
  font-weight: 800;
  color: rgba(255, 255, 255, 0.7);
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
  margin-left: 8px;
}

.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  margin-right: 2px;
}

.dot.valid {
  background: rgba(34, 197, 94, 0.95);
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
}

.dot.invalid {
  background: rgba(239, 68, 68, 0.95);
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
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
  max-width: 760px;
  border-radius: 16px;
  background: #0f1730;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 16px;
}

.ta {
  width: 100%;
  min-height: 240px;
  padding: 10px 12px;
  border-radius: 12px;
  resize: vertical;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
</style>
