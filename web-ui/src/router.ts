import { createRouter, createWebHistory } from 'vue-router'
import LoginView from './views/LoginView.vue'
import HomeView from './views/HomeView.vue'
import TokensView from './views/TokensView.vue'
import ImageGenView from './views/ImageGenView.vue'
import VideoGenView from './views/VideoGenView.vue'
import AdminLayout from './layouts/AdminLayout.vue'
import { getToken, clearToken } from './lib/api'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/login', component: LoginView },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', redirect: '/home' },
        { path: 'home', component: HomeView },
        { path: 'image-gen', component: ImageGenView },
        { path: 'video-gen', component: VideoGenView },
        { path: 'tokens', component: TokensView },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/home' },
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
