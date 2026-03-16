export const API_BASE = '';

export interface ApiBody<T = any> {
  code: number
  message: string
  data: T
}

export interface LoginData {
  token: string
  exp?: number
}

// ---- Admin Token types & APIs ----
export interface AdminTokenRecord {
  id: string
  token_value: string
  status: 'valid' | 'invalid'
  node?: 'cn' | 'jp' | 'us' | 'hk' | 'sg'
  created_at: string
  updated_at: string
}

export async function adminTokenList(): Promise<{ tokens: AdminTokenRecord[] }> {
  return await apiFetch<{ tokens: AdminTokenRecord[] }>('/api/admin/tokens', { method: 'GET' })
}

export async function adminTokenDelete(id: string): Promise<void> {
  await apiFetch(`/api/admin/tokens/${id}`, { method: 'DELETE' })
}

export async function adminTokenImport(text: string): Promise<{ inserted: number; skipped: number; totalLines?: number; totalTokens?: number }> {
  return await apiFetch('/api/admin/tokens/import', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

async function parseApiError(resp: Response): Promise<string> {
  let msg = `请求失败 (${resp.status})`
  try {
    const data = (await resp.json()) as Partial<ApiBody<any>> & { errmsg?: string; message?: string }
    msg = (data as any)?.message || (data as any)?.errmsg || msg
  } catch {
    // ignore
  }
  return msg
}

export function getToken(): string | null {
  return localStorage.getItem('admin_token')
}

export function setToken(token: string) {
  localStorage.setItem('admin_token', token)
}

export function clearToken() {
  localStorage.removeItem('admin_token')
}

/**
 * 默认 fetch：给“后台管理 API（/api/admin/*）”自动附加 admin JWT。
 * 生成类接口（/v1/*）绝不能附加 admin JWT，否则会被后端当作即梦 token 使用。
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers || {})

  // 对于 JSON 请求自动补 Content-Type，但如果是 FormData 让浏览器自己处理 boundary
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  // 只对 /api/admin 前缀自动加 Authorization
  if (token && path.startsWith('/api/admin')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })

  if (!resp.ok) {
    throw new Error(await parseApiError(resp))
  }

  const body = (await resp.json()) as ApiBody<T>
  if (typeof body?.code === 'number' && body.code !== 0) {
    throw new Error(body?.message || '请求失败')
  }

  // 兼容极端情况下后端直接返回裸对象
  return (body && 'data' in body ? (body.data as T) : (body as any as T))
}

export async function adminLogin(username: string, password: string): Promise<LoginData> {
  return await apiFetch<LoginData>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function adminMe(): Promise<any> {
  return await apiFetch('/api/admin/me', { method: 'GET' })
}
