import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { apiError } from '../services/api'

export function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [delivery, setDelivery] = useState<'development' | 'email'>('email')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { requestCode, login } = useAuth()
  const navigate = useNavigate()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (step === 'email') {
        const response = await requestCode(email)
        setDelivery(response.delivery)
        setStep('code')
      } else {
        await login(email, code)
        navigate('/dashboard')
      }
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth">
    <section className="auth-panel">
      <Logo size={58}/><span className="eyebrow">SolveSphere identity</span>
      <h1>Welcome back.</h1>
      <p>Your role and permissions come from the SolveSphere server after your email is verified.</p>
    </section>
    <section className="auth-form">
      <Logo/><h2>Sign in</h2><p>Access your SolveSphere workspace.</p>
      <form onSubmit={submit}>
        <label>Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required disabled={step === 'code' || busy}/>
        </label>
        {step === 'code' && <>
          <label>6-digit verification code
            <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter the code" required autoFocus/>
          </label>
          {delivery === 'development' && <div className="info">Local development mode is active. Use the code configured in the backend environment.</div>}
        </>}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : step === 'email' ? 'Send verification code' : 'Verify & continue'}</button>
        {step === 'code' && <button type="button" className="text-link" onClick={() => { setStep('email'); setCode(''); setError('') }}>Use another email</button>}
      </form>
    </section>
  </main>
}
