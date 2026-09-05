import { useEffect, useState } from 'react'
import { ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { useAuth } from '../context/AuthContext'
import { accountApi, apiError } from '../services/api'
import type { User } from '../types'

export function Profile() {
  const { updateUser } = useAuth()
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

  if (!profile && !error) return <Loading label="Loading profile…"/>
  return <section className="page"><div className="page-head"><div><span className="eyebrow">Your identity</span><h1>Profile</h1><p>Manage your SolveSphere contribution profile.</p></div></div>{error && <ErrorBanner message={error}/>} {success && <SuccessBanner message={success}/>} {profile && <div className="panel profile"><div className="avatar-lg">{profile.name.slice(0, 1).toUpperCase()}</div><h2>{profile.name}</h2><span className="badge">{profile.role}</span><p>{profile.email}</p><form className="compact-form" onSubmit={save}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required/></label><label>Avatar URL<input type="url" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)}/></label><button className="btn btn-primary" disabled={busy}>Save profile</button></form><hr/><div className="profile-grid"><div><small>Role</small><strong>{profile.role}</strong></div><div><small>Member ID</small><strong>{profile.id}</strong></div></div></div>}</section>
}
