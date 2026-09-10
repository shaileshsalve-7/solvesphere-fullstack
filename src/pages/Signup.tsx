import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Loading } from '../components/States'
import { Logo } from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { apiError, apiErrorCode } from '../services/api'
import type { PublicSignupRole, VerificationDelivery } from '../types'

const roles: Array<{ value: PublicSignupRole; label: string; description: string }> = [
  { value: 'Citizen', label: 'Citizen', description: 'Report and follow societal challenges.' },
  { value: 'Student', label: 'Student', description: 'Form teams and build solutions.' },
  { value: 'Mentor', label: 'Mentor', description: 'Review solutions and guide teams.' },
]

export function Signup() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<PublicSignupRole>('Citizen')
  const [code, setCode] = useState('')
  const [delivery, setDelivery] = useState<VerificationDelivery | null>(null)
  const verifying = searchParams.get('verify') === '1'
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const { user, loading, signup, resendVerification, verifyEmail } = useAuth()
  const navigate = useNavigate()

  function setVerifying(value: boolean) {
    setSearchParams(value ? { verify: '1', email: email.trim() } : {}, { replace: true })
  }

  if (loading) return <Loading label="Checking your session…"/>
  if (user) return <Navigate to={user.role === 'Admin' ? '/admin' : '/dashboard'} replace/>

  async function createAccount(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError('Password must include uppercase, lowercase, a number, and a symbol.')
      return
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError('Password must be at most 72 UTF-8 bytes.')
      return
    }
    setBusy(true)
    try {
      const response = await signup({ name: name.trim(), email: email.trim(), password, role })
      setEmail(response.email)
      setDelivery(response)
      setVerifying(true)
      setCode('')
    } catch (requestError) {
      setError(apiError(requestError))
      if (['verification_delivery_failed', 'email_exists'].includes(apiErrorCode(requestError) ?? '')) {
        setVerifying(true)
        setDelivery(null)
        setCode('')
      }
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      const verified = await verifyEmail(email.trim(), code)
      navigate(verified.role === 'Admin' ? '/admin' : '/dashboard', { replace: true })
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError('')
    setSuccess('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address first.')
      return
    }
    setDelivery(null)
    setBusy(true)
    try {
      const response = await resendVerification(email.trim())
      setDelivery(response)
      setVerifying(true)
      setSuccess(response.delivery === 'email' ? 'A new verification code was sent. Check your inbox and spam folder; use the latest code within 10 minutes.' : 'Local test mode: email delivery is disabled.')
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth">
    <section className="auth-panel">
      <Logo size={58}/><span className="eyebrow">Join SolveSphere</span>
      <h1>Help solve what matters.</h1>
      <p>Create a verified account as a citizen, student, or mentor. Administrator access is managed securely by the platform.</p>
    </section>
    <section className="auth-form">
      <Logo/><h2>{verifying ? 'Verify your email' : 'Create account'}</h2>
      <div className="login-mode" role="group" aria-label="Account setup">
        <button type="button" className={!verifying ? 'active' : ''} aria-pressed={!verifying} disabled={busy} onClick={() => { setVerifying(false); setError(''); setSuccess('') }}>Create account</button>
        <button type="button" className={verifying ? 'active' : ''} aria-pressed={verifying} data-testid="verify-email-option" disabled={busy} onClick={() => { setVerifying(true); setError(''); setSuccess('') }}>Verify email / enter code</button>
      </div>
      {!verifying ? <>
        <p>Choose how you will contribute. Your selected role is validated by the server.</p>
        <form data-testid="signup-form" onSubmit={createAccount}>
          <label>Full name
            <input name="name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} autoComplete="name" required disabled={busy}/>
          </label>
          <label>Email
            <input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required disabled={busy}/>
          </label>
          <fieldset className="role-picker">
            <legend>I want to join as</legend>
            <div className="role-grid">{roles.map((item) => <button type="button" data-role={item.value} className={role === item.value ? 'active' : ''} aria-pressed={role === item.value} onClick={() => setRole(item.value)} key={item.value} disabled={busy}><b>{item.label}</b><small>{item.description}</small></button>)}</div>
          </fieldset>
          <label>Password
            <input name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required disabled={busy}/>
            <small className="field-help">Use 8–72 UTF-8 bytes with uppercase, lowercase, a number, and a symbol.</small>
          </label>
          <label>Confirm password
            <input name="confirmPassword" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required disabled={busy}/>
          </label>
          {error && <div className="error" role="alert">{error}</div>}
          <p className="field-help">Next: enter the 6-digit code sent to your email to activate your account.</p>
          <button className="btn btn-primary" data-testid="signup-submit" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account & send code'}</button>
        </form>
      </> : <>
        <p>Already created an account? Enter your email and code below, or request a new code.</p>
        {delivery && <div className="info" role="status">{delivery.delivery === 'email' ? 'Code sent. Check your inbox and spam folder. It expires in 10 minutes.' : 'Local test mode: email delivery is disabled.'}</div>}
        <form data-testid="verification-form" onSubmit={verify}>
          <label>Email to verify
            <input name="email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setDelivery(null); setCode(''); setError(''); setSuccess('') }} placeholder="you@example.com" autoComplete="email" required disabled={busy}/>
          </label>
          <label>6-digit verification code
            <input name="verificationCode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="Enter the code" autoComplete="one-time-code" required autoFocus disabled={busy}/>
          </label>
          {error && <div className="error" role="alert">{error}</div>}
          {success && <div className="success" role="status">{success}</div>}
          <button className="btn btn-primary" data-testid="verification-submit" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify & continue'}</button>
          <div className="auth-inline-actions">
            <button type="button" className="text-link" onClick={resend} disabled={busy || !email.trim()}>Send / resend code</button>
            <button type="button" className="text-link" onClick={() => { setVerifying(false); setDelivery(null); setCode(''); setError(''); setSuccess('') }} disabled={busy}>Create a different account</button>
          </div>
        </form>
      </>}
      <p className="auth-switch">Already verified? <Link className="text-link" to="/login">Sign in</Link></p>
      <Link className="text-link auth-home" to="/">← Back to home</Link>
    </section>
  </main>
}
