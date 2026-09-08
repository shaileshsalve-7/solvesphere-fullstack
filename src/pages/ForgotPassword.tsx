import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { apiError, authApi, storeSession } from '../services/api'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [requested, setRequested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function requestCode(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await authApi.requestPasswordReset(email.trim()); setRequested(true) }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  async function reset(event: React.FormEvent) {
    event.preventDefault(); setError('')
    if (password !== confirmPassword) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const session = await authApi.resetPassword(email.trim(), code, password)
      storeSession(session)
      navigate(session.user.role === 'Admin' ? '/admin' : '/dashboard', { replace: true })
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  return <main className="auth"><section className="auth-panel"><Logo size={58}/><span className="eyebrow">Account recovery</span><h1>Reset your password.</h1><p>A six-digit code will be sent only to your registered email.</p></section><section className="auth-form"><Logo/><h2>Forgot password</h2>{!requested ? <form onSubmit={requestCode}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required disabled={busy}/></label>{error && <div className="error" role="alert">{error}</div>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</button></form> : <form onSubmit={reset}><p>Enter the code sent to <strong>{email}</strong>.</p><label>6-digit reset code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" required/></label><label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required/></label><label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required/></label>{error && <div className="error" role="alert">{error}</div>}<button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Resetting…' : 'Reset password'}</button></form>}<Link className="text-link auth-home" to="/login">← Back to sign in</Link></section></main>
}
