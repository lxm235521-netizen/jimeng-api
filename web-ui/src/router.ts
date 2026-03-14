import { createRouter, createWebHistory } from 'vue-router'
import LoginView from './views/LoginView.vue'
import HomeView from './views/HomeView.vue'
import TokenView from './views/TokenView.vue'
import { getToken, clearToken } from './lib/api'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', component: LoginView },
    { path: '/home', component: HomeView },
    { path: '/tokens', component: TokenView },
  ],
})

router.beforeEach((to) => {
  if (to.path === '/login') return true

  const token = getToken()
  if (!token) return { path: '/login' }

  return true
})

router.afterEach(() => {
  // 监听 localStorage 被外部清理时（比如另一个 tab）
  // 简单兜底：如果 token 不存在且不在 login 页面，则跳回登录页
  const token = getToken()
  if (!token && router.currentRoute.value.path !== '/login') {
    clearToken()
    router.replace('/login')
  }
})

export default router
