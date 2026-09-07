import { useCallback, useEffect, useState } from 'react'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { adminApi, apiError, challengeApi } from '../services/api'
import type { AdminOverview, AdminReview, Challenge, ChallengeStatus, Solution, Team, User, UserRole } from '../types'

const roles: UserRole[] = ['Citizen', 'Student', 'Mentor', 'Admin']
const statusTransitions: Record<ChallengeStatus, ChallengeStatus[]> = {
  'Under review': ['Published', 'Rejected'],
  Published: ['In progress', 'Rejected'],
  'In progress': ['Implemented', 'Rejected'],
  Rejected: ['Under review'],
  Implemented: [],
}

function statusLabel(current: ChallengeStatus, next: ChallengeStatus) {
  if (current === 'Under review' && next === 'Published') return 'Approve & publish'
  if (next === 'Implemented') return 'Final approval: implemented'
  if (next === 'Rejected') return 'Reject'
  if (next === 'Under review') return 'Return to review'
  return `Move to ${next}`
}

export function Admin() {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [reviews, setReviews] = useState<AdminReview[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const [nextOverview, nextUsers, nextChallenges, nextTeams, nextSolutions, nextReviews] = await Promise.all([
        adminApi.overview(), adminApi.users(), adminApi.challenges(), adminApi.teams(), adminApi.solutions(), adminApi.reviews(),
      ])
      setOverview(nextOverview)
      setUsers(nextUsers)
      setChallenges(nextChallenges)
      setTeams(nextTeams)
      setSolutions(nextSolutions)
      setReviews(nextReviews)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function setRole(id: string, role: UserRole) {
    setBusyId(`user-${id}`); setError(''); setSuccess('')
    try {
      await adminApi.setRole(id, role)
      setSuccess(`Role updated to ${role}.`)
      await load(false)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setBusyId('')
    }
  }

  async function moderate(id: string, status: ChallengeStatus) {
    setBusyId(`challenge-${id}`); setError(''); setSuccess('')
    try {
      const reason = status === 'Rejected'
        ? 'Rejected from the administrator console.'
        : status === 'Published'
          ? 'Verified and published by an administrator.'
          : `Moved to ${status} from the administrator console.`
      await challengeApi.updateStatus(id, status, reason)
      setSuccess(status === 'Published' ? 'Challenge approved and published.' : status === 'Implemented' ? 'Final implementation status approved.' : `Challenge moved to ${status}.`)
      await load(false)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setBusyId('')
    }
  }

  if (loading) return <Loading label="Loading administrator console…"/>
  const userCount = overview?.totalUsers ?? overview?.usersByRole.reduce((total, item) => total + Number(item.count), 0) ?? users.length
  const challengeCount = overview?.totalChallenges ?? overview?.challengesByStatus.reduce((total, item) => total + Number(item.count), 0) ?? challenges.length
  const awaitingReview = overview?.solutionsByStatus.find((item) => item.status === 'Mentor review')?.count ?? solutions.filter((item) => item.status === 'Mentor review').length

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">Platform governance</span><h1>Admin console</h1><p>Moderate challenges, manage users, and inspect teams, solutions, and mentor feedback.</p></div><button className="btn btn-secondary" onClick={() => load()} disabled={Boolean(busyId)}>Refresh data</button></div>
    {error && <ErrorBanner message={error}/>} {success && <SuccessBanner message={success}/>}
    <div className="stats"><article><small>Users</small><strong>{userCount}</strong></article><article><small>Challenges</small><strong>{challengeCount}</strong></article><article><small>Active teams</small><strong>{overview?.activeTeams ?? teams.filter((team) => team.status === 'Active').length}</strong></article><article><small>Awaiting review</small><strong>{awaitingReview}</strong></article></div>

    <div className="admin-sections">
      <div className="admin-wide-grid">
        <div className="panel" data-testid="admin-challenges"><h2>Challenge moderation</h2>{challenges.length ? challenges.map((challenge) => <div className="row admin-row" data-challenge-id={challenge.id} key={challenge.id}><div><b>{challenge.title}</b><small>{challenge.status} • {challenge.location} • reported by {challenge.owner}</small></div><div className="admin-status-actions"><span className={`badge ${challenge.priority.toLowerCase()}`}>{challenge.status}</span>{statusTransitions[challenge.status].length > 0 && <div className="card-actions">{statusTransitions[challenge.status].map((status) => <button className={`btn ${status === 'Published' || status === 'Implemented' ? 'btn-primary' : 'btn-secondary'}`} data-action={`status-${status.toLowerCase().replaceAll(' ', '-')}`} aria-label={`${statusLabel(challenge.status, status)} ${challenge.title}`} onClick={() => moderate(challenge.id, status)} disabled={Boolean(busyId)} key={status}>{statusLabel(challenge.status, status)}</button>)}</div>}</div></div>) : <Empty message="No challenges have been reported."/>}</div>

        <div className="panel" data-testid="admin-users"><h2>Users and roles</h2>{users.length ? users.map((user) => <div className="row" data-user-id={user.id} key={user.id}><div><b>{user.name}</b><small>{user.email}</small></div><select aria-label={`Role for ${user.name}`} value={user.role} onChange={(event) => setRole(user.id, event.target.value as UserRole)} disabled={Boolean(busyId)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></div>) : <Empty message="No users have registered."/>}</div>
      </div>

      <div className="admin-wide-grid">
        <div className="panel" data-testid="admin-teams"><h2>Teams</h2>{teams.length ? teams.map((team) => <div className="row" data-team-id={team.id} key={team.id}><div><b>{team.name}</b><small>{team.challenge} • owner {team.owner} • {team.members} members • {team.solutions ?? 0} solutions</small></div><span className="badge">{team.status}</span></div>) : <Empty message="No teams have been formed."/>}</div>

        <div className="panel" data-testid="admin-solutions"><h2>Solutions</h2>{solutions.length ? solutions.map((solution) => <div className="row" data-solution-id={solution.id} key={solution.id}><div><b>{solution.title}</b><small>{solution.team} • {solution.challenge} • {solution.reviewCount ?? 0} reviews{solution.latestFeedback ? ` • ${solution.latestFeedback}` : ''}</small></div><span className="badge">{solution.status}</span></div>) : <Empty message="No solutions have been created."/>}</div>
      </div>

      <div className="panel" data-testid="admin-reviews"><h2>Mentor feedback</h2>{reviews.length ? reviews.map((review) => <div className="row" data-review-id={review.id} key={review.id}><div><b>{review.solution || 'Solution review'} — {review.decision}</b><small>{review.feedback} • reviewed by {review.reviewer}</small></div><span className="badge">{new Date(review.createdAt).toLocaleDateString()}</span></div>) : <Empty message="No mentor reviews have been recorded."/>}</div>
      <div className="panel" data-testid="admin-platform-data"><h2>Platform activity</h2><div className="profile-grid"><div><small>Evidence files</small><strong>{overview?.evidenceFiles ?? 0}</strong></div><div><small>Progress updates</small><strong>{overview?.progressUpdates ?? 0}</strong></div><div><small>Mentor reviews</small><strong>{overview?.totalReviews ?? reviews.length}</strong></div><div><small>Total solutions</small><strong>{overview?.totalSolutions ?? solutions.length}</strong></div></div></div>
    </div>
  </section>
}
