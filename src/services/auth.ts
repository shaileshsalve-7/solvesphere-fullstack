import type { User } from '../types'
import { authApi, clearSession, getStoredUser, storeSession, storeUser } from './api'

export const auth = {
  getUser: getStoredUser,
  async restore(): Promise<User | null> {
    if (!getStoredUser()) return null
    try {
      const user = await authApi.me()
      storeUser(user)
      return user
    } catch {
      clearSession()
      return null
    }
  },
  requestCode: authApi.requestCode,
  async verifyCode(email: string, code: string) {
    const session = await authApi.verifyCode(email, code)
    storeSession(session)
    return session.user
  },
  async logout() {
    const refreshToken = localStorage.getItem('ss_refresh_token')
    try { if (refreshToken) await authApi.logout(refreshToken) } finally { clearSession() }
  },
}
