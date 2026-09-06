import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type {
  AdminOverview, AdminReview, AuthSession, Challenge, ChallengeStatus, DashboardSummary, Notification, Priority,
  ProgressUpdate, PublicSignupRole, Solution, Team, User, UserRole, VerificationDelivery,
} from '../types'

const ACCESS_KEY = 'ss_access_token'
const REFRESH_KEY = 'ss_refresh_token'
const USER_KEY = 'ss_user'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
})

export function getStoredUser(): User | null {
  try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null } catch { return null }
}

export function storeSession(session: AuthSession) {
  localStorage.setItem(ACCESS_KEY, session.accessToken)
  localStorage.setItem(REFRESH_KEY, session.refreshToken)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
}

export function storeUser(user: User) { localStorage.setItem(USER_KEY, JSON.stringify(user)) }

export function clearSession() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshPromise: Promise<string> | null = null
api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (error.response?.status !== 401 || !original || original._retry || !refreshToken || original.url?.includes('/auth/refresh')) throw error
  original._retry = true
  refreshPromise ??= axios.post(`${api.defaults.baseURL}/auth/refresh`, { refreshToken }).then(({ data }) => {
    storeSession(data)
    return data.accessToken as string
  }).catch((refreshError) => {
    clearSession()
    throw refreshError
  }).finally(() => { refreshPromise = null })
  original.headers.Authorization = `Bearer ${await refreshPromise}`
  return api(original)
})

export function apiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined
    return data?.message ?? data?.error ?? error.message
  }
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export function apiErrorCode(error: unknown) {
  if (!axios.isAxiosError(error)) return undefined
  return (error.response?.data as { error?: string } | undefined)?.error
}

export const authApi = {
  signup: (payload: { name: string; email: string; password: string; role: PublicSignupRole }) => api.post<VerificationDelivery>('/auth/signup', payload).then((r) => r.data),
  verifyEmail: (email: string, code: string) => api.post<AuthSession>('/auth/verify-email', { email, code }).then((r) => r.data),
  resendVerification: (email: string) => api.post<VerificationDelivery>('/auth/resend-verification', { email }).then((r) => r.data),
  login: (email: string, password: string) => api.post<AuthSession>('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get<{ user: User }>('/auth/me').then((r) => r.data.user),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
}

export const challengeApi = {
  list: (params?: { q?: string; status?: ChallengeStatus; priority?: Priority; category?: string; limit?: number; mine?: boolean }) => api.get<{ items: Challenge[] }>('/challenges', { params }).then((r) => r.data.items),
  get: (id: string) => api.get<Challenge>(`/challenges/${id}`).then((r) => r.data),
  create: (payload: { title: string; description: string; category: string; location: string; priority: Priority }) => api.post<Challenge>('/challenges', payload).then((r) => r.data),
  updateStatus: (id: string, status: ChallengeStatus, reason?: string) => api.patch<{ id: string; status: ChallengeStatus }>(`/challenges/${id}/status`, { status, reason }).then((r) => r.data),
  evidence: (id: string) => api.get<{ items: Array<{ id: string; originalName: string; mimeType: string; sizeBytes: number; caption?: string; uploadedBy: string; createdAt: string }> }>(`/challenges/${id}/evidence`).then((r) => r.data.items),
  uploadEvidence: (id: string, file: File, caption: string) => {
    const form = new FormData()
    form.append('file', file)
    if (caption) form.append('caption', caption)
    return api.post(`/challenges/${id}/evidence`, form, { headers: { 'Content-Type': undefined } }).then((r) => r.data)
  },
  downloadEvidence: (id: string) => api.get<Blob>(`/evidence/${id}/download`, { responseType: 'blob' }).then((r) => r.data),
}

export const teamApi = {
  list: (challengeId?: string) => api.get<{ items: Team[] }>('/teams', { params: challengeId ? { challengeId } : undefined }).then((r) => r.data.items),
  get: (id: string) => api.get<Team>(`/teams/${id}`).then((r) => r.data),
  create: (challengeId: string, name: string) => api.post<Team>(`/challenges/${challengeId}/teams`, { name }).then((r) => r.data),
  join: (id: string) => api.post(`/teams/${id}/join`, {}).then((r) => r.data),
  leave: (id: string) => api.delete(`/teams/${id}/members/me`),
}

export const solutionApi = {
  list: (params?: { teamId?: string; challengeId?: string; status?: Solution['status']; mine?: boolean }) => api.get<{ items: Solution[] }>('/solutions', { params }).then((r) => r.data.items),
  get: (id: string) => api.get<Solution>(`/solutions/${id}`).then((r) => r.data),
  create: (teamId: string, payload: { title: string; description: string; repositoryUrl?: string; demoUrl?: string }) => api.post<Solution>(`/teams/${teamId}/solutions`, payload).then((r) => r.data),
  update: (id: string, payload: { title?: string; description?: string; repositoryUrl?: string; demoUrl?: string }) => api.patch<Solution>(`/solutions/${id}`, payload).then((r) => r.data),
  submit: (id: string) => api.post<{ id: string; status: Solution['status'] }>(`/solutions/${id}/submit`, {}).then((r) => r.data),
  review: (id: string, payload: { decision: 'Approved' | 'Changes requested'; feedback: string }) => api.patch(`/solutions/${id}/review`, payload).then((r) => r.data),
  progress: (id: string) => api.get<{ items: ProgressUpdate[] }>(`/solutions/${id}/progress`).then((r) => r.data.items),
  addProgress: (id: string, payload: { summary: string; completionPercent: number; blockers?: string; milestoneDate?: string }) => api.post<ProgressUpdate>(`/solutions/${id}/progress`, payload).then((r) => r.data),
}

export const accountApi = {
  profile: () => api.get<User>('/profiles/me').then((r) => r.data),
  updateProfile: (payload: { name?: string; avatarUrl?: string | null }) => api.patch<User>('/profiles/me', payload).then((r) => r.data),
  notifications: () => api.get<{ items: Notification[] }>('/notifications').then((r) => r.data.items),
  readNotification: (id: string) => api.patch(`/notifications/${id}/read`, {}).then((r) => r.data),
  readAll: () => api.patch<{ updated: number }>('/notifications/read-all', {}).then((r) => r.data),
  dashboard: () => api.get<DashboardSummary>('/dashboard').then((r) => r.data),
}

export const adminApi = {
  users: () => api.get<{ items: User[] }>('/admin/users').then((r) => r.data.items),
  setRole: (id: string, role: UserRole) => api.patch<Pick<User, 'id' | 'role'>>(`/admin/users/${id}/role`, { role }).then((r) => r.data),
  overview: () => api.get<AdminOverview>('/admin/overview').then((r) => r.data),
  challenges: () => api.get<{ items: Challenge[] }>('/admin/challenges').then((r) => r.data.items),
  teams: () => api.get<{ items: Team[] }>('/admin/teams').then((r) => r.data.items),
  solutions: () => api.get<{ items: Solution[] }>('/admin/solutions').then((r) => r.data.items),
  reviews: () => api.get<{ items: AdminReview[] }>('/admin/reviews').then((r) => r.data.items),
}
