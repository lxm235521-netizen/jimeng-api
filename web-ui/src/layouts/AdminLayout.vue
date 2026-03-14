<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearToken } from '../lib/api'

const router = useRouter()
const route = useRoute()

const items = [
  { path: '/home', label: '概览' },
  { path: '/image-gen', label: '图片生成' },
  { path: '/tokens', label: 'Token 管理' },
]

const activePath = computed(() => route.path)

function go(path: string) {
  router.push(path)
}

function logout() {
  clearToken()
  router.push('/login')
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand" @click="go('/home')">
        <div class="logo">J</div>
        <div>
          <div class="title">Jimeng Admin</div>
          <div class="sub">管理后台</div>
        </div>
      </div>

      <nav class="nav">
        <button
          v-for="it in items"
          :key="it.path"
          class="navItem"
          :class="{ active: activePath === it.path }"
          @click="go(it.path)"
        >
          {{ it.label }}
        </button>
      </nav>

      <div class="sp"></div>

      <button class="logout" @click="logout">退出登录</button>
    </aside>

    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 240px 1fr;
  background: #0b1020;
  color: rgba(255, 255, 255, 0.9);
}

.sidebar {
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(11, 16, 32, 0.92);
}

.brand {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border-radius: 14px;
  cursor: pointer;
  user-select: none;
}

.brand:hover {
  background: rgba(255, 255, 255, 0.05);
}

.logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #6366f1, #22c55e);
  color: #fff;
  font-weight: 900;
}

.title {
  font-weight: 900;
}

.sub {
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}

.nav {
  display: grid;
  gap: 8px;
}

.navItem {
  text-align: left;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
}

.navItem:hover {
  background: rgba(255, 255, 255, 0.07);
}

.navItem.active {
  border-color: rgba(99, 102, 241, 0.7);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
}

.sp {
  flex: 1;
}

.logout {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
}

.logout:hover {
  background: rgba(255, 255, 255, 0.09);
}

.main {
  padding: 18px;
}

@media (max-width: 980px) {
  .shell {
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: sticky;
    top: 0;
    z-index: 10;
    flex-direction: row;
    align-items: center;
  }
  .nav {
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    gap: 8px;
  }
  .sp {
    display: none;
  }
}
</style>
