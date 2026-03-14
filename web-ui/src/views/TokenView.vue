<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  adminTokenDelete,
  adminTokenImport,
  adminTokenList,
  type AdminTokenRecord,
} from '../lib/api'

const tokens = ref<AdminTokenRecord[]>([])
const loading = ref(false)
const error = ref('')

const showImport = ref(false)
const importText = ref('')
const importLoading = ref(false)
const importResult = ref('')

const validCount = computed(() => tokens.value.filter((t) => t.status === 'valid').length)

async function load() {
  error.value = ''
  loading.value = true
  try {
    const data = await adminTokenList()
    tokens.value = data.tokens || []
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function doDelete(id: string) {
  if (!confirm('确认删除该 Token？')) return
  try {
    await adminTokenDelete(id)
    await load()
  } catch (e: any) {
    alert(e?.message || '删除失败')
  }
}

function openImport() {
  importResult.value = ''
  importText.value = ''
  showImport.value = true
}

async function submitImport() {
  importResult.value = ''
  importLoading.value = true
  try {
    const r = await adminTokenImport(importText.value)
    importResult.value = `导入完成：新增 ${r.inserted}，跳过 ${r.skipped}`
    await load()
  } catch (e: any) {
    importResult.value = e?.message || '导入失败'
  } finally {
    importLoading.value = false
  }
}

onMounted(() => {
  load()
})
</script>

<template>
  <div class="wrap">
    <header class="top">
      <div class="left">
        <div class="badge">T</div>
        <div class="name">Token 池</div>
        <div class="meta">有效 {{ validCount }} / 总数 {{ tokens.length }}</div>
      </div>
      <div class="right">
        <button class="btn" @click="openImport">批量导入</button>
        <button class="btn ghost" :disabled="loading" @click="load">刷新</button>
      </div>
    </header>

    <main class="main">
      <div v-if="error" class="error">{{ error }}</div>

      <div class="card">
        <div class="table">
          <div class="thead">
            <div>ID</div>
            <div>Token（前 24 字符）</div>
            <div>状态</div>
            <div>更新时间</div>
            <div></div>
          </div>

          <div v-if="loading" class="row muted">加载中…</div>
          <div v-else-if="tokens.length === 0" class="row muted">暂无 Token，请先导入。</div>

          <div v-else v-for="t in tokens" :key="t.id" class="trow">
            <div class="mono">{{ t.id }}</div>
            <div class="mono">{{ t.token_value.slice(0, 24) }}…</div>
            <div>
              <span class="pill" :class="t.status === 'valid' ? 'ok' : 'bad'">
                {{ t.status === 'valid' ? '有效' : '无效' }}
              </span>
            </div>
            <div class="mono">{{ t.updated_at }}</div>
            <div class="actions">
              <button class="btn danger" @click="doDelete(t.id)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="showImport" class="modal">
        <div class="dialog">
          <div class="dlgTitle">批量导入 Token</div>
          <div class="dlgHint">支持按换行分割；每行也支持逗号分隔。可粘贴带 Bearer 前缀的内容，会自动剥离。</div>

          <textarea v-model="importText" class="ta" rows="10" placeholder="us-xxx\nhk-yyy\n..." />

          <div v-if="importResult" class="result">{{ importResult }}</div>

          <div class="dlgActions">
            <button class="btn ghost" :disabled="importLoading" @click="showImport = false">关闭</button>
            <button class="btn" :disabled="importLoading" @click="submitImport">
              {{ importLoading ? '提交中…' : '提交导入' }}
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  background: #0b1020;
  color: rgba(255, 255, 255, 0.9);
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  position: sticky;
  top: 0;
  backdrop-filter: blur(10px);
  background: rgba(11, 16, 32, 0.65);
}

.left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.badge {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #6366f1, #22c55e);
  font-weight: 800;
}

.name {
  font-weight: 800;
}

.meta {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}

.right {
  display: flex;
  gap: 10px;
}

.main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 22px;
  display: grid;
  gap: 14px;
}

.card {
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 14px;
}

.table {
  display: grid;
  gap: 8px;
}

.thead {
  display: grid;
  grid-template-columns: 2fr 2fr 0.6fr 1.4fr 0.6fr;
  gap: 10px;
  padding: 10px 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
}

.trow {
  display: grid;
  grid-template-columns: 2fr 2fr 0.6fr 1.4fr 0.6fr;
  gap: 10px;
  align-items: center;
  padding: 10px 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
}

.row.muted {
  padding: 14px 8px;
  color: rgba(255, 255, 255, 0.5);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  word-break: break-all;
}

.pill {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.pill.ok {
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(34, 197, 94, 0.3);
  color: rgba(187, 247, 208, 0.95);
}

.pill.bad {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.3);
  color: rgba(254, 202, 202, 0.95);
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.btn {
  border-radius: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
}

.btn.ghost {
  background: transparent;
}

.btn.danger {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.28);
  color: rgba(254, 202, 202, 0.95);
}

.error {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.28);
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
}

.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 22px;
}

.dialog {
  width: 100%;
  max-width: 720px;
  border-radius: 16px;
  background: rgba(20, 24, 40, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 16px;
}

.dlgTitle {
  font-weight: 800;
  margin-bottom: 6px;
}

.dlgHint {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  margin-bottom: 10px;
}

.ta {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
  padding: 10px 12px;
  outline: none;
  resize: vertical;
}

.result {
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
}

.dlgActions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
