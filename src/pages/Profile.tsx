import { useEffect, useState } from 'react'
import { LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { useAuth } from '../context/AuthContext'
import { accountApi, apiError } from '../services/api'
import type { User } from '../types'
import './Profile.css'

export function Profile() {
  const { updateUser, logout } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<User | null>(null)
  const [name, setName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { accountApi.profile().then((user) => { setProfile(user); setName(user.name); setAvatarUrl(user.avatarUrl ?? '') }).catch((requestError) => setError(apiError(requestError))) }, [])
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try { const user = await accountApi.updateProfile({ name, avatarUrl: avatarUrl || null }); setProfile(user); updateUser(user); setSuccess('Profile updated.') }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  async function signOut() {
    setBusy(true)
    await logout()
    navigate('/', { replace: true })
  }

  if (!profile && !error) return <Loading label="Loading profile…"/>
  return <section className="page"><div className="page-head"><div><span className="eyebrow">Your identity</span><h1>Profile</h1><p>Manage your SolveSphere account and sign-in session.</p></div></div>{error && <ErrorBanner message={error}/>} {success && <SuccessBanner message={success}/>} {profile && <div className="profile-layout"><aside className="panel profile-summary">{profile.avatarUrl ? <img className="avatar-lg avatar-image" src={profile.avatarUrl} alt="Profile"/> : <div className="avatar-lg">{profile.name.slice(0, 1).toUpperCase()}</div>}<h2>{profile.name}</h2><span className="badge">{profile.role}</span><div className="profile-facts"><div><Mail size={16}/><span><small>Email</small><strong>{profile.email}</strong></span></div><div><ShieldCheck size={16}/><span><small>Account role</small><strong>{profile.role}</strong></span></div><div><UserRound size={16}/><span><small>Member ID</small><strong>{profile.id}</strong></span></div></div><button className="btn btn-danger profile-logout" data-testid="profile-logout-button" type="button" onClick={() => void signOut()} disabled={busy}><LogOut size={16}/> Log out</button></aside><div className="panel profile-editor"><h2>Edit profile</h2><p>Keep your display name and optional profile image up to date.</p><form className="compact-form" data-testid="profile-form" onSubmit={save}><label>Display name<input name="name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required disabled={busy}/></label><label>Avatar URL<input name="avatarUrl" type="url" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://example.com/photo.jpg" disabled={busy}/><small className="field-help">Leave blank to use your initial.</small></label><button className="btn btn-primary" data-action="save-profile" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></form></div></div>}</section>
}
