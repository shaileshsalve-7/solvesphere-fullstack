import { useCallback, useEffect, useState } from 'react'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { useAuth } from '../context/AuthContext'
import { apiError, solutionApi, teamApi } from '../services/api'
import type { ProgressUpdate, Solution, Team } from '../types'

const initialForm = { teamId: '', title: '', description: '', repositoryUrl: '', demoUrl: '' }
const initialEditForm = { title: '', description: '', repositoryUrl: '', demoUrl: '' }

export function Solutions() {
  const { user } = useAuth()
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [form, setForm] = useState(initialForm)
  const [showForm, setShowForm] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(initialEditForm)
  const [feedback, setFeedback] = useState('')
  const [progressSummary, setProgressSummary] = useState('')
  const [completion, setCompletion] = useState(25)
  const [blockers, setBlockers] = useState('')
  const [milestoneDate, setMilestoneDate] = useState('')
  const [progressBySolution, setProgressBySolution] = useState<Record<string, ProgressUpdate[]>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const solutionFilters = user?.role === 'Student' ? { mine: true } : user?.role === 'Mentor' ? { status: 'Mentor review' as const } : undefined
      const [nextSolutions, listedTeams] = await Promise.all([solutionApi.list(solutionFilters), user?.role === 'Student' ? teamApi.list() : Promise.resolve([])])
      const detailedTeams = await Promise.all(listedTeams.map((team) => teamApi.get(team.id)))
      const memberTeams = detailedTeams.filter((team) => team.memberList?.some((member) => member.id === user?.id))
      const progressEntries = await Promise.all(nextSolutions.map(async (solution) => [solution.id, await solutionApi.progress(solution.id)] as const))
      setSolutions(nextSolutions); setTeams(memberTeams); setProgressBySolution(Object.fromEntries(progressEntries))
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setLoading(false) }
  }, [user?.id, user?.role])

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

  function openEdit(solution: Solution) {
    setActiveId(null)
    setEditingId(editingId === solution.id ? null : solution.id)
    setEditForm({
      title: solution.title,
      description: solution.description,
      repositoryUrl: solution.repositoryUrl ?? '',
      demoUrl: solution.demoUrl ?? '',
    })
  }

  async function saveEdit(event: React.FormEvent, id: string) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try {
      await solutionApi.update(id, {
        title: editForm.title,
        description: editForm.description,
        repositoryUrl: editForm.repositoryUrl || undefined,
        demoUrl: editForm.demoUrl || undefined,
      })
      setEditingId(null); setEditForm(initialEditForm); setSuccess('Solution changes saved.'); await load()
    } catch (requestError) { setError(apiError(requestError)) }
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
    try { await solutionApi.addProgress(id, { summary: progressSummary, completionPercent: completion, blockers: blockers || undefined, milestoneDate: milestoneDate || undefined }); setProgressSummary(''); setBlockers(''); setMilestoneDate(''); setActiveId(null); setSuccess('Progress update saved.'); await load() }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">Solution lifecycle</span><h1>Solutions</h1><p>Submit, review and improve ideas until they are ready for real-world impact.</p></div>{user?.role === 'Student' && <button className="btn btn-primary" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close form' : 'Create solution'}</button>}</div>
    {error && <ErrorBanner message={error}/>}
    {success && <SuccessBanner message={success}/>}
    {showForm && <form className="panel form-grid" data-testid="solution-form" onSubmit={create}><h2>New solution draft</h2><label>Team<select name="teamId" value={form.teamId} onChange={({ target: { value } }) => setForm((current) => ({ ...current, teamId: value }))} required><option value="">Select your team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name} — {team.challenge}</option>)}</select></label><label>Title<input name="title" value={form.title} onChange={({ target: { value } }) => setForm((current) => ({ ...current, title: value }))} minLength={5} required/></label><label className="span-2">Description<textarea name="description" value={form.description} onChange={({ target: { value } }) => setForm((current) => ({ ...current, description: value }))} minLength={30} required/></label><label>Repository URL<input name="repositoryUrl" type="url" value={form.repositoryUrl} onChange={({ target: { value } }) => setForm((current) => ({ ...current, repositoryUrl: value }))}/></label><label>Demo URL<input name="demoUrl" type="url" value={form.demoUrl} onChange={({ target: { value } }) => setForm((current) => ({ ...current, demoUrl: value }))}/></label><button className="btn btn-primary" data-action="create-solution" disabled={busy}>Create draft</button></form>}
    {loading ? <Loading label="Loading solutions…"/> : solutions.length ? <div className="solution-list">{solutions.map((solution) => <article className="panel" data-solution-id={solution.id} key={solution.id}>
      <div className="row"><div><b>{solution.title}</b><small>{solution.team} • {solution.challenge}</small></div><span className="badge">{solution.status}</span></div>
      <p>{solution.description}</p>{solution.feedback && <div className="info">Latest feedback: {solution.feedback}</div>}
      {(progressBySolution[solution.id]?.length ?? 0) > 0 && <div className="info">Latest progress: {progressBySolution[solution.id][0].completionPercent}% — {progressBySolution[solution.id][0].summary}</div>}
      <div className="card-actions">
        {user?.role === 'Student' && ['Draft', 'Changes requested'].includes(solution.status) && <button className="btn btn-primary" data-action="submit-solution" onClick={() => submit(solution.id)} disabled={busy}>Submit for review</button>}
        {user?.role === 'Student' && ['Draft', 'Changes requested'].includes(solution.status) && <button className="btn btn-secondary" data-action="edit-solution" onClick={() => openEdit(solution)} disabled={busy}>Edit solution</button>}
        {user?.role === 'Student' && <button className="btn btn-secondary" data-action="open-progress" onClick={() => { setEditingId(null); setActiveId(activeId === solution.id ? null : solution.id) }}>Add progress</button>}
        {(user?.role === 'Mentor' || user?.role === 'Admin') && solution.status === 'Mentor review' && <button className="btn btn-primary" data-action="open-review" onClick={() => setActiveId(activeId === solution.id ? null : solution.id)}>Review</button>}
      </div>
      {editingId === solution.id && user?.role === 'Student' && <form className="compact-form" data-testid="solution-edit-form" onSubmit={(event) => saveEdit(event, solution.id)}><label>Title<input name="title" value={editForm.title} onChange={({ target: { value } }) => setEditForm((current) => ({ ...current, title: value }))} minLength={5} maxLength={180} required/></label><label>Description<textarea name="description" value={editForm.description} onChange={({ target: { value } }) => setEditForm((current) => ({ ...current, description: value }))} minLength={30} maxLength={15000} required/></label><label>Repository URL<input name="repositoryUrl" type="url" value={editForm.repositoryUrl} onChange={({ target: { value } }) => setEditForm((current) => ({ ...current, repositoryUrl: value }))}/></label><label>Demo URL<input name="demoUrl" type="url" value={editForm.demoUrl} onChange={({ target: { value } }) => setEditForm((current) => ({ ...current, demoUrl: value }))}/></label><div className="card-actions"><button className="btn btn-primary" data-action="save-solution" disabled={busy}>Save changes</button><button className="btn btn-secondary" type="button" onClick={() => setEditingId(null)} disabled={busy}>Cancel</button></div></form>}
      {activeId === solution.id && user?.role === 'Student' && <div className="compact-form" data-testid="progress-form"><label>Progress summary<textarea name="summary" value={progressSummary} onChange={(event) => setProgressSummary(event.target.value)} minLength={10}/></label><label>Blockers (optional)<textarea name="blockers" value={blockers} onChange={(event) => setBlockers(event.target.value)} maxLength={3000}/></label><label>Milestone date (optional)<input name="milestoneDate" type="date" value={milestoneDate} onChange={(event) => setMilestoneDate(event.target.value)}/></label><label>Completion: {completion}%<input name="completionPercent" type="range" min="0" max="100" value={completion} onChange={(event) => setCompletion(Number(event.target.value))}/></label><button className="btn btn-primary" data-action="save-progress" onClick={() => addProgress(solution.id)} disabled={busy || progressSummary.trim().length < 10}>Save progress</button></div>}
      {activeId === solution.id && (user?.role === 'Mentor' || user?.role === 'Admin') && <div className="compact-form" data-testid="review-form"><label>Mentor feedback<textarea name="feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} minLength={10}/></label><div className="card-actions"><button className="btn btn-primary" data-action="approve-solution" onClick={() => review(solution.id, 'Approved')} disabled={busy || feedback.trim().length < 10}>Approve</button><button className="btn btn-secondary" data-action="request-changes" onClick={() => review(solution.id, 'Changes requested')} disabled={busy || feedback.trim().length < 10}>Request changes</button></div></div>}
    </article>)}</div> : <Empty message="No solutions have been created yet."/>}
  </section>
}
