import { createRouter, createWebHistory } from 'vue-router'
import LoginView from './views/LoginView.vue'
import HomeView from './views/HomeView.vue'
import TokensView from './views/TokensView.vue'
import { getToken, clearToken } from './lib/api'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', component: LoginView },
    { path: '/home', component: HomeView },
    { path: '/tokens', component: TokensView },
  ],
})

router.beforeEach((to) => {
  if (to.path === '/login') return true

  const token = getToken()
  if (!token) return { path: '/login' }

  return true
})

router.afterEach(() => {
  const token = getToken()
  if (!token && router.currentRoute.value.path !== '/login') {
    clearToken()
    router.replace('/login')
  }
})

export default router
