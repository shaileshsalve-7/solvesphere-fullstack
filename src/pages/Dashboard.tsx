import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, Target, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, ErrorBanner, Loading } from '../components/States'
import { useAuth } from '../context/AuthContext'
import { accountApi, apiError, challengeApi, solutionApi } from '../services/api'
import type { Challenge, DashboardSummary, Solution } from '../types'

export function Dashboard() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([accountApi.dashboard(), challengeApi.list({ limit: 4 }), solutionApi.list()])
      .then(([nextSummary, nextChallenges, nextSolutions]) => { setSummary(nextSummary); setChallenges(nextChallenges); setSolutions(nextSolutions.slice(0, 4)) })
      .catch((requestError) => setError(apiError(requestError)))
  }, [])

  if (!summary && !error) return <Loading label="Loading your workspace…"/>
  const stats: Array<{ Icon: LucideIcon; label: string; value: number }> = summary ? [
    { Icon: Target, label: 'Active challenges', value: summary.challenges.open },
    { Icon: Users, label: 'My teams', value: summary.teams.mine },
    { Icon: CheckCircle2, label: 'My solutions', value: summary.solutions.mine },
    { Icon: AlertTriangle, label: 'Critical issues', value: summary.challenges.critical },
  ] : []

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">{user?.role} workspace</span><h1>Good to see you, {user?.name}.</h1><p>Track civic challenges, collaboration and measurable progress.</p></div><Link className="btn btn-primary" to="/challenges">Explore challenges</Link></div>
    {error && <ErrorBanner message={error}/>}
    <div className="stats">{stats.map(({ Icon, label, value }) => <article key={label}><Icon size={20}/><small>{label}</small><strong>{value}</strong></article>)}</div>
    <div className="grid">
      <div className="panel"><h2>Priority challenges</h2>{challenges.length ? challenges.map((challenge) => <Link to={`/challenges/${challenge.id}`} className="row" key={challenge.id}><div><b>{challenge.title}</b><small>{challenge.category} • {challenge.location}</small></div><span className={`badge ${challenge.priority.toLowerCase()}`}>{challenge.priority}</span></Link>) : <Empty message="No challenges have been published yet."/>}</div>
      <div className="panel"><h2>Recent solutions</h2>{solutions.length ? solutions.map((solution) => <div className="row" key={solution.id}><div><b>{solution.title}</b><small>{solution.team}</small></div><span className="badge">{solution.status}</span></div>) : <Empty message="No solutions have been submitted yet."/>}</div>
    </div>
  </section>
}
