import type { PublicSignupRole, User } from '../types'
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
  signup: (payload: { name: string; email: string; password: string; role: PublicSignupRole }) => authApi.signup(payload),
  resendVerification: authApi.resendVerification,
  async verifyEmail(email: string, code: string) {
    const session = await authApi.verifyEmail(email, code)
    storeSession(session)
    return session.user
  },
  async login(email: string, password: string) {
    const session = await authApi.login(email, password)
    storeSession(session)
    return session.user
  },
  async logout() {
    const refreshToken = localStorage.getItem('ss_refresh_token')
    try { if (refreshToken) await authApi.logout(refreshToken) }
    catch { /* Local sign-out must still succeed if the session already expired or the API is unavailable. */ }
    finally { clearSession() }
  },
}
