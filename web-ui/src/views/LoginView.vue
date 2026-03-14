<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminLogin, setToken } from '../lib/api'

const router = useRouter()

const username = ref('admin')
const password = ref('admin')
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    const data = await adminLogin(username.value.trim(), password.value)
    setToken(data.token)
    await router.push('/home')
  } catch (e: any) {
    error.value = e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="card">
      <div class="brand">
        <div class="logo">J</div>
        <div>
          <div class="title">Jimeng Admin</div>
          <div class="subtitle">管理后台</div>
        </div>
      </div>

      <form class="form" @submit.prevent="onSubmit">
        <label class="field">
          <span>用户名</span>
          <input v-model="username" autocomplete="username" placeholder="admin" />
        </label>

        <label class="field">
          <span>密码</span>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="••••••••" />
        </label>

        <button class="btn" type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登录' }}
        </button>

        <div v-if="error" class="error">{{ error }}</div>
      </form>

      <div class="hint">默认账号：admin / admin（请上线前修改 configs/dev/system.yml）</div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(1200px 600px at 20% 10%, rgba(99, 102, 241, 0.25), transparent 55%),
    radial-gradient(900px 500px at 80% 20%, rgba(16, 185, 129, 0.18), transparent 55%),
    radial-gradient(900px 500px at 30% 85%, rgba(236, 72, 153, 0.12), transparent 55%),
    #0b1020;
}

.card {
  width: 100%;
  max-width: 420px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 24px;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}

.brand {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}

.logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #6366f1, #22c55e);
  color: #fff;
  font-weight: 800;
  letter-spacing: 1px;
}

.title {
  color: rgba(255, 255, 255, 0.92);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.1;
}

.subtitle {
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  margin-top: 2px;
}

.form {
  display: grid;
  gap: 14px;
}

.field {
  display: grid;
  gap: 8px;
}

.field > span {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  outline: none;
}

input:focus {
  border-color: rgba(99, 102, 241, 0.7);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
}

.btn {
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(34, 197, 94, 0.9));
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.65;
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

.hint {
  margin-top: 14px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
}
</style>
