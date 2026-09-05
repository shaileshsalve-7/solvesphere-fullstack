import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '../types'
import { auth } from '../services/auth'
import { storeUser } from '../services/api'

type AuthContextValue = {
  user: User | null
  loading: boolean
  requestCode: (email: string) => ReturnType<typeof auth.requestCode>
  login: (email: string, code: string) => Promise<void>
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
    requestCode: auth.requestCode,
    login: async (email, code) => setUser(await auth.verifyCode(email, code)),
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
