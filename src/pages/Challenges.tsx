import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { challengeApi, apiError } from '../services/api'
import type { Challenge, Priority } from '../types'

const initialForm = { title: '', description: '', category: '', location: '', priority: 'Medium' as Priority }

export function Challenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setChallenges(await challengeApi.list({ q: query || undefined, category: category === 'All' ? undefined : category, limit: 100 })) }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setLoading(false) }
  }, [category, query])

  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer) }, [load])
  const categories = useMemo(() => [...new Set(challenges.map((challenge) => challenge.category))], [challenges])

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try {
      await challengeApi.create(form)
      setForm(initialForm); setShowForm(false); setSuccess('Challenge submitted for administrator review.'); await load()
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">Community needs</span><h1>Challenges</h1><p>Discover problems that need people, ideas and practical action.</p></div><button className="btn btn-primary" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close form' : 'Report challenge'}</button></div>
    {error && <ErrorBanner message={error}/>}
    {success && <SuccessBanner message={success}/>}
    {showForm && <form className="panel form-grid" onSubmit={create}>
      <h2>Report a societal challenge</h2>
      <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={8} maxLength={180} required/></label>
      <label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} required/></label>
      <label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} required/></label>
      <label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label>
      <label className="span-2">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} minLength={30} maxLength={10000} required/></label>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
    </form>}
    <div className="filters"><input placeholder="Search challenges or locations" value={query} onChange={(event) => setQuery(event.target.value)}/><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></div>
    {loading ? <Loading label="Loading challenges…"/> : challenges.length ? <div className="cards">{challenges.map((challenge) => <Link className="challenge" to={`/challenges/${challenge.id}`} key={challenge.id}><div><span className={`badge ${challenge.priority.toLowerCase()}`}>{challenge.priority}</span> <span className="badge">{challenge.status}</span></div><h2>{challenge.title}</h2><p>{challenge.category} • {challenge.location}</p><div className="progress"><i style={{ width: `${challenge.readiness}%` }}/></div><small>{challenge.readiness}% solution readiness • {challenge.teams} teams</small></Link>)}</div> : <Empty message="No challenges match these filters."/>}
  </section>
}
