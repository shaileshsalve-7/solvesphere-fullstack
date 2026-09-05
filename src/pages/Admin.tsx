import { useCallback, useEffect, useState } from 'react'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { adminApi, apiError, challengeApi } from '../services/api'
import type { AdminOverview, Challenge, ChallengeStatus, User, UserRole } from '../types'

const roles: UserRole[] = ['Citizen', 'Student', 'Mentor', 'Admin']

export function Admin() {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [nextOverview, nextUsers, nextChallenges] = await Promise.all([adminApi.overview(), adminApi.users(), challengeApi.list({ limit: 100 })])
      setOverview(nextOverview); setUsers(nextUsers); setChallenges(nextChallenges)
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function setRole(id: string, role: UserRole) {
    setError(''); setSuccess('')
    try { await adminApi.setRole(id, role); setSuccess(`Role updated to ${role}.`); await load() }
    catch (requestError) { setError(apiError(requestError)) }
  }
  async function moderate(id: string, status: ChallengeStatus) {
    setError(''); setSuccess('')
    try { await challengeApi.updateStatus(id, status, 'Updated from the administrator console.'); setSuccess(`Challenge moved to ${status}.`); await load() }
    catch (requestError) { setError(apiError(requestError)) }
  }

  if (loading) return <Loading label="Loading administrator console…"/>
  const userCount = overview?.usersByRole.reduce((total, item) => total + Number(item.count), 0) ?? 0
  const challengeCount = overview?.challengesByStatus.reduce((total, item) => total + Number(item.count), 0) ?? 0

  return <section className="page"><div className="page-head"><div><span className="eyebrow">Platform governance</span><h1>Admin console</h1><p>Review challenges, assign verified roles and monitor the platform.</p></div></div>{error && <ErrorBanner message={error}/>} {success && <SuccessBanner message={success}/>} <div className="stats"><article><small>Users</small><strong>{userCount}</strong></article><article><small>Challenges</small><strong>{challengeCount}</strong></article><article><small>Active teams</small><strong>{overview?.activeTeams ?? 0}</strong></article><article><small>Awaiting review</small><strong>{overview?.solutionsByStatus.find((item) => item.status === 'Mentor review')?.count ?? 0}</strong></article></div>
    <div className="grid"><div className="panel"><h2>Challenge moderation</h2>{challenges.length ? challenges.map((challenge) => <div className="row admin-row" data-challenge-id={challenge.id} key={challenge.id}><div><b>{challenge.title}</b><small>{challenge.status} • {challenge.location}</small></div>{challenge.status === 'Under review' ? <div className="card-actions"><button className="btn btn-primary" data-action="publish" onClick={() => moderate(challenge.id, 'Open')}>Publish</button><button className="btn btn-secondary" onClick={() => moderate(challenge.id, 'Denied')}>Deny</button></div> : <span className={`badge ${challenge.priority.toLowerCase()}`}>{challenge.priority}</span>}</div>) : <Empty message="No challenges need moderation."/>}</div>
      <div className="panel"><h2>User roles</h2>{users.map((user) => <div className="row" key={user.id}><div><b>{user.name}</b><small>{user.email}</small></div><select value={user.role} onChange={(event) => setRole(user.id, event.target.value as UserRole)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></div>)}</div></div>
  </section>
}
