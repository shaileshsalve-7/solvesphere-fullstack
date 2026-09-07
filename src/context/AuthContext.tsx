import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PublicSignupRole, User, UserRole } from '../types'
import { auth } from '../services/auth'
import { storeUser } from '../services/api'

type AuthContextValue = {
  user: User | null
  loading: boolean
  signup: (payload: { name: string; email: string; password: string; role: PublicSignupRole }) => ReturnType<typeof auth.signup>
  resendVerification: (email: string) => ReturnType<typeof auth.resendVerification>
  verifyEmail: (email: string, code: string) => Promise<User>
  login: (email: string, password: string, requiredRole?: UserRole) => Promise<User>
  logout: () => Promise<void>
  updateUser: (user: User) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => auth.getUser())
  const [loading, setLoading] = useState(Boolean(user))

  useEffect(() => {
    let active = true
    auth.restore().then((restored) => { if (active) setUser(restored) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signup: auth.signup,
    resendVerification: auth.resendVerification,
    verifyEmail: async (email, code) => { const verified = await auth.verifyEmail(email, code); setUser(verified); return verified },
    login: async (email, password, requiredRole) => {
      const signedIn = await auth.login(email, password)
      if (requiredRole && signedIn.role !== requiredRole) {
        await auth.logout()
        throw new Error(`This account does not have ${requiredRole.toLowerCase()} access.`)
      }
      setUser(signedIn)
      return signedIn
    },
    logout: async () => { await auth.logout(); setUser(null) },
    updateUser: (updated) => { storeUser(updated); setUser(updated) },
  }), [loading, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
