import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Loading } from '../components/States'
import { Logo } from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { apiError, apiErrorCode } from '../services/api'

export function Login() {
  const [loginMode, setLoginMode] = useState<'user' | 'admin'>('user')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [busy, setBusy] = useState(false)
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const requestedPath = (location.state as { from?: string } | null)?.from

  if (loading) return <Loading label="Checking your session…"/>
  if (user) return <Navigate to={user.role === 'Admin' ? '/admin' : '/dashboard'} replace/>

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setErrorCode('')
    setBusy(true)
    try {
      const signedIn = await login(email.trim(), password, loginMode === 'admin' ? 'Admin' : undefined)
      navigate(requestedPath || (signedIn.role === 'Admin' ? '/admin' : '/dashboard'), { replace: true })
    } catch (requestError) {
      setError(apiError(requestError))
      setErrorCode(apiErrorCode(requestError) ?? '')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth">
    <section className="auth-panel">
      <Logo size={58}/><span className="eyebrow">SolveSphere identity</span>
      <h1>Welcome back.</h1>
      <p>Sign in to report challenges, collaborate with a student team, review solutions, or manage the platform.</p>
    </section>
    <section className="auth-form">
      <Logo/><h2>{loginMode === 'admin' ? 'Admin sign in' : 'Sign in'}</h2><p>{loginMode === 'admin' ? 'Use your provisioned administrator account.' : 'Use the email and password for your verified account.'}</p>
      <div className="login-mode" role="group" aria-label="Login type">
        <button className={loginMode === 'user' ? 'active' : ''} type="button" onClick={() => setLoginMode('user')}>User login</button>
        <button className={loginMode === 'admin' ? 'active' : ''} data-testid="admin-login-option" type="button" onClick={() => setLoginMode('admin')}>Admin login</button>
      </div>
      <form data-testid="login-form" onSubmit={submit}>
        <label>Email
          <input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required disabled={busy}/>
        </label>
        <label>Password
          <input name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" minLength={8} maxLength={72} required disabled={busy}/>
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        {errorCode === 'email_not_verified' && <Link className="text-link" to={`/signup?verify=1&email=${encodeURIComponent(email.trim())}`}>Verify this email</Link>}
        <button className="btn btn-primary" data-testid="login-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="info" data-testid="admin-login-hint"><strong>Administrator?</strong> Select Admin login above. Your role is always verified by the server.</p>
      <p className="auth-switch">New to SolveSphere? <Link className="text-link" to="/signup">Create an account</Link></p>
      <Link className="text-link auth-home" to="/">← Back to home</Link>
    </section>
  </main>
}
