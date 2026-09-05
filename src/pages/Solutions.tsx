import { useCallback, useEffect, useState } from 'react'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { useAuth } from '../context/AuthContext'
import { apiError, solutionApi, teamApi } from '../services/api'
import type { Solution, Team } from '../types'

const initialForm = { teamId: '', title: '', description: '', repositoryUrl: '', demoUrl: '' }

export function Solutions() {
  const { user } = useAuth()
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [form, setForm] = useState(initialForm)
  const [showForm, setShowForm] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [progressSummary, setProgressSummary] = useState('')
  const [completion, setCompletion] = useState(25)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [nextSolutions, nextTeams] = await Promise.all([solutionApi.list(), teamApi.list()])
      setSolutions(nextSolutions); setTeams(nextTeams)
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try {
      await solutionApi.create(form.teamId, { title: form.title, description: form.description, repositoryUrl: form.repositoryUrl || undefined, demoUrl: form.demoUrl || undefined })
      setForm(initialForm); setShowForm(false); setSuccess('Solution draft created.'); await load()
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  async function submit(id: string) {
    setBusy(true); setError(''); setSuccess('')
    try { await solutionApi.submit(id); setSuccess('Solution submitted for mentor review.'); await load() }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  async function review(id: string, decision: 'Approved' | 'Changes requested') {
    setBusy(true); setError(''); setSuccess('')
    try { await solutionApi.review(id, { decision, feedback }); setFeedback(''); setActiveId(null); setSuccess(`Review saved: ${decision}.`); await load() }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  async function addProgress(id: string) {
    setBusy(true); setError(''); setSuccess('')
    try { await solutionApi.addProgress(id, { summary: progressSummary, completionPercent: completion }); setProgressSummary(''); setActiveId(null); setSuccess('Progress update saved.'); await load() }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">Solution lifecycle</span><h1>Solutions</h1><p>Submit, review and improve ideas until they are ready for real-world impact.</p></div>{user?.role === 'Student' && <button className="btn btn-primary" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close form' : 'Create solution'}</button>}</div>
    {error && <ErrorBanner message={error}/>}
    {success && <SuccessBanner message={success}/>}
    {showForm && <form className="panel form-grid" onSubmit={create}><h2>New solution draft</h2><label>Team<select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })} required><option value="">Select your team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name} — {team.challenge}</option>)}</select></label><label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={5} required/></label><label className="span-2">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} minLength={30} required/></label><label>Repository URL<input type="url" value={form.repositoryUrl} onChange={(event) => setForm({ ...form, repositoryUrl: event.target.value })}/></label><label>Demo URL<input type="url" value={form.demoUrl} onChange={(event) => setForm({ ...form, demoUrl: event.target.value })}/></label><button className="btn btn-primary" disabled={busy}>Create draft</button></form>}
    {loading ? <Loading label="Loading solutions…"/> : solutions.length ? <div className="solution-list">{solutions.map((solution) => <article className="panel" key={solution.id}>
      <div className="row"><div><b>{solution.title}</b><small>{solution.team} • {solution.challenge}</small></div><span className="badge">{solution.status}</span></div>
      <p>{solution.description}</p>{solution.feedback && <div className="info">Latest feedback: {solution.feedback}</div>}
      <div className="card-actions">
        {user?.role === 'Student' && ['Draft', 'Changes requested'].includes(solution.status) && <button className="btn btn-primary" onClick={() => submit(solution.id)} disabled={busy}>Submit for review</button>}
        {user?.role === 'Student' && <button className="btn btn-secondary" onClick={() => setActiveId(activeId === solution.id ? null : solution.id)}>Add progress</button>}
        {(user?.role === 'Mentor' || user?.role === 'Admin') && solution.status === 'Mentor review' && <button className="btn btn-primary" onClick={() => setActiveId(activeId === solution.id ? null : solution.id)}>Review</button>}
      </div>
      {activeId === solution.id && user?.role === 'Student' && <div className="compact-form"><label>Progress summary<textarea value={progressSummary} onChange={(event) => setProgressSummary(event.target.value)} minLength={10}/></label><label>Completion: {completion}%<input type="range" min="0" max="100" value={completion} onChange={(event) => setCompletion(Number(event.target.value))}/></label><button className="btn btn-primary" onClick={() => addProgress(solution.id)} disabled={busy || progressSummary.length < 10}>Save progress</button></div>}
      {activeId === solution.id && (user?.role === 'Mentor' || user?.role === 'Admin') && <div className="compact-form"><label>Mentor feedback<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} minLength={10}/></label><div className="card-actions"><button className="btn btn-primary" onClick={() => review(solution.id, 'Approved')} disabled={busy || feedback.length < 10}>Approve</button><button className="btn btn-secondary" onClick={() => review(solution.id, 'Changes requested')} disabled={busy || feedback.length < 10}>Request changes</button></div></div>}
    </article>)}</div> : <Empty message="No solutions have been created yet."/>}
  </section>
}
