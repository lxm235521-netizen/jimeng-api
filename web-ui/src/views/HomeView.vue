<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminMe, clearToken } from '../lib/api'

const router = useRouter()

const me = ref<any>(null)
const loading = ref(false)
const error = ref('')

async function loadMe() {
  error.value = ''
  loading.value = true
  try {
    me.value = await adminMe()
  } catch (e: any) {
    const msg = e?.message || '加载失败'
    error.value = msg
    if (/401/.test(msg) || /未登录/.test(msg) || /过期/.test(msg) || /Token/.test(msg)) {
      clearToken()
      await router.push('/login')
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadMe()
})
</script>

<template>
  <div class="page">
    <div class="card">
      <div class="h">概览</div>
      <div class="p">当前登录信息（GET /api/admin/me）</div>

      <div v-if="loading" class="p">加载中…</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <pre v-else class="mono">{{ JSON.stringify(me, null, 2) }}</pre>
    </div>

    <div class="card">
      <div class="h">快捷入口</div>
      <div class="p">左侧导航：图片生成 / Token 管理</div>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 14px;
}
</style>
