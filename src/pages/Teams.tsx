import { useCallback, useEffect, useState } from 'react'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { useAuth } from '../context/AuthContext'
import { apiError, challengeApi, teamApi } from '../services/api'
import type { Challenge, Team } from '../types'

export function Teams() {
  const { user } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [challengeId, setChallengeId] = useState('')
  const [name, setName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [nextTeams, nextChallenges] = await Promise.all([teamApi.list(), challengeApi.list({ limit: 100 })])
      setTeams(nextTeams); setChallenges(nextChallenges.filter((item) => ['Open', 'In progress'].includes(item.status)))
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try { await teamApi.create(challengeId, name); setName(''); setChallengeId(''); setShowForm(false); setSuccess('Team created.'); await load() }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  async function join(id: string) {
    setBusy(true); setError(''); setSuccess('')
    try { await teamApi.join(id); setSuccess('You joined the team.'); await load() }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">Student collaboration</span><h1>Teams</h1><p>Build focused teams around challenges and ship solutions together.</p></div>{user?.role === 'Student' && <button className="btn btn-primary" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close form' : 'Create team'}</button>}</div>
    {error && <ErrorBanner message={error}/>}
    {success && <SuccessBanner message={success}/>}
    {showForm && <form className="panel form-grid" onSubmit={create}><h2>Create a team</h2><label>Challenge<select value={challengeId} onChange={(event) => setChallengeId(event.target.value)} required><option value="">Select a challenge</option>{challenges.map((challenge) => <option value={challenge.id} key={challenge.id}>{challenge.title}</option>)}</select></label><label>Team name<input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={100} required/></label><button className="btn btn-primary" disabled={busy}>Create team</button></form>}
    {loading ? <Loading label="Loading teams…"/> : teams.length ? <div className="cards">{teams.map((team) => <article className="panel" key={team.id}><span className="badge">{team.status}</span><h2>{team.name}</h2><p>{team.challenge}</p><strong>{team.members} members</strong>{user?.role === 'Student' && <div className="card-actions"><button className="btn btn-secondary" onClick={() => join(team.id)} disabled={busy}>Join team</button></div>}</article>)}</div> : <Empty message="No teams have been created yet."/>}
  </section>
}
