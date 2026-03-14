<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminMe, clearToken, getToken } from '../lib/api'

const router = useRouter()

const token = ref<string | null>(getToken())
const me = ref<any>(null)
const loading = ref(false)
const error = ref('')

function logout() {
  clearToken()
  router.push('/login')
}

async function loadMe() {
  error.value = ''
  loading.value = true
  try {
    me.value = await adminMe()
  } catch (e: any) {
    const msg = e?.message || '加载失败'
    error.value = msg
    // 如果后端返回 401 / 未登录，直接清理 token 并跳转
    if (/401/.test(msg) || /未登录/.test(msg) || /过期/.test(msg) || /Token/.test(msg)) {
      clearToken()
      await router.push('/login')
    }
  } finally {
    loading.value = false
  }
}

function goTokens() {
  router.push('/tokens')
}

function goImageGen() {
  router.push('/image-gen')
}

onMounted(() => {
  loadMe()
})
</script>

<template>
  <div class="wrap">
    <header class="top">
      <div class="left">
        <div class="badge">J</div>
        <div class="name">Jimeng Admin</div>
      </div>
      <div class="right">
        <button class="nav" @click="goImageGen">图片生成</button>
        <button class="nav" @click="goTokens">Token 管理</button>
        <button class="logout" @click="logout">退出登录</button>
      </div>
    </header>

    <main class="main">
      <div class="card">
        <div class="h">当前登录信息</div>
        <div class="p">后端接口：GET /api/admin/me</div>

        <div v-if="loading" class="p">加载中…</div>
        <div v-else-if="error" class="error">{{ error }}</div>
        <pre v-else class="mono">{{ JSON.stringify(me, null, 2) }}</pre>

        <div class="sp"></div>
        <div class="p">Admin JWT（本地保存）：</div>
        <div class="mono">{{ token ? token.slice(0, 28) + '…' : '(none)' }}</div>
      </div>

      <div class="card">
        <div class="h">常用入口</div>
        <div class="p">图片生成控制台：不需要填写 Authorization，后端会自动从 Token 池抽取有效 token。</div>
        <div class="row">
          <button class="btn" @click="goImageGen">进入图片生成</button>
          <button class="btn ghost" @click="goTokens">进入 Token 管理</button>
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
  gap: 10px;
}

.right {
  display: flex;
  align-items: center;
  gap: 10px;
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
  font-weight: 700;
}

.nav {
  border-radius: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
}

.logout {
  border-radius: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
}

.main {
  max-width: 980px;
  margin: 0 auto;
  padding: 22px;
  display: grid;
  gap: 14px;
}

.card {
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 18px;
}

.h {
  font-weight: 700;
  margin-bottom: 6px;
}

.p {
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
}

.mono {
  margin-top: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
  word-break: break-all;
  white-space: pre-wrap;
}

pre.mono {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px;
  overflow: auto;
}

.error {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.28);
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
  margin-top: 10px;
}

.sp {
  height: 8px;
}

.row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.btn {
  border-radius: 12px;
  padding: 10px 12px;
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
</style>
