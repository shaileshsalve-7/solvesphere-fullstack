import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { useAuth } from '../context/AuthContext'
import { challengeApi, apiError } from '../services/api'
import type { Challenge, Priority } from '../types'

export const CURATED_CATEGORIES = [
  'Roads & Infrastructure',
  'Water & Sanitation',
  'Waste Management',
  'Public Safety',
  'Traffic & Mobility',
  'Parks & Accessibility',
  'Education & Youth',
  'Environment & Energy',
  'Healthcare',
] as const

const initialForm = {
  title: '',
  description: '',
  category: 'Roads & Infrastructure',
  location: '',
  priority: 'Medium' as Priority,
}

export function Challenges() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [showForm, setShowForm] = useState(searchParams.get('report') === '1')
  const [form, setForm] = useState(initialForm)
  const [otherSelected, setOtherSelected] = useState(false)
  const [otherCategoryDetails, setOtherCategoryDetails] = useState('')
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [evidenceCaption, setEvidenceCaption] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const filters = {
        q: query || undefined,
        category: categoryFilter === 'All' ? undefined : categoryFilter,
        limit: 100,
      }
      const [published, owned] = await Promise.all([
        challengeApi.list(filters),
        user?.role === 'Citizen' ? challengeApi.list({ ...filters, mine: true }) : Promise.resolve([]),
      ])
      setChallenges([...new Map([...owned, ...published].map((challenge) => [challenge.id, challenge])).values()])
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, query, user?.role])

  useEffect(() => {
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [load])

  const allAvailableCategories = useMemo(() => {
    const set = new Set<string>()
    for (const c of challenges) {
      if (c.category) {
        for (const cat of c.category.split(',')) set.add(cat.trim())
      }
    }
    for (const cat of CURATED_CATEGORIES) set.add(cat)
    return Array.from(set).filter(Boolean).sort()
  }, [challenges])

  // Parse currently selected categories from the category string
  const activeCategories = useMemo(() => {
    return form.category.split(',').map((s) => s.trim()).filter(Boolean)
  }, [form.category])

  function toggleCategory(cat: string) {
    const currentList = form.category.split(',').map((s) => s.trim()).filter(Boolean)
    let nextList: string[]
    if (currentList.includes(cat)) {
      nextList = currentList.filter((c) => c !== cat)
    } else {
      nextList = [...currentList, cat]
    }
    setForm((current) => ({
      ...current,
      category: nextList.join(', '),
    }))
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')

    const categoryParts = form.category.split(',').map((s) => s.trim()).filter(Boolean)
    if (otherSelected) categoryParts.push('Other')
    if (categoryParts.length === 0) {
      setError('Please select or specify at least one category.')
      setBusy(false)
      return
    }

    try {
      const created = await challengeApi.create({
        ...form,
        description: otherSelected
          ? `${form.description}\n\nOther category details: ${otherCategoryDetails.trim()}`
          : form.description,
        category: categoryParts.join(', '),
      })
      if (evidenceFile) await challengeApi.uploadEvidence(created.id, evidenceFile, evidenceCaption)
      setForm(initialForm)
      setOtherSelected(false)
      setOtherCategoryDetails('')
      setEvidenceFile(null)
      setEvidenceCaption('')
      setShowForm(false)
      setSuccess(
        evidenceFile
          ? 'Challenge and evidence submitted for administrator review.'
          : 'Challenge submitted for administrator review.',
      )
      await load()
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Community needs</span>
          <h1>Challenges</h1>
          <p>Discover problems that need people, ideas and practical action.</p>
        </div>
        {user?.role === 'Citizen' && (
          <button
            className="btn btn-primary"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? 'Close form' : 'Report challenge'}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {success && <SuccessBanner message={success} />}

      {showForm && (
        <form
          className="panel form-grid"
          data-testid="challenge-form"
          onSubmit={create}
        >
          <h2>Report a societal challenge</h2>

          <label>
            Title
            <input
              name="title"
              value={form.title}
              onChange={({ target: { value } }) =>
                setForm((current) => ({ ...current, title: value }))
              }
              placeholder="e.g. Dangerous potholes on the main school road"
              minLength={8}
              maxLength={180}
              required
            />
          </label>

          <label>
            Location
            <input
              name="location"
              value={form.location}
              onChange={({ target: { value } }) =>
                setForm((current) => ({ ...current, location: value }))
              }
              placeholder="e.g. Kothrud, Pune, Maharashtra"
              minLength={2}
              maxLength={180}
              required
            />
          </label>

          <label>
            Priority
            <select
              name="priority"
              value={form.priority}
              onChange={({ target: { value } }) =>
                setForm((current) => ({
                  ...current,
                  priority: value as Priority,
                }))
              }
            >
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option>Critical</option>
            </select>
          </label>

          {/* Category Input with Multi-Select Pills & Custom Other Support */}
          <div className="span-2">
            <label style={{ display: 'block', marginBottom: '4px' }}>
              Category
              <input
                name="category"
                value={form.category}
                onChange={({ target: { value } }) =>
                  setForm((current) => ({ ...current, category: value }))
                }
                placeholder="Select tags below or type custom categories (e.g. Roads & Infrastructure, Wildlife Protection)..."
                required
              />
            </label>

            <div style={{ marginTop: '8px' }}>
              <small style={{ display: 'block', color: '#64748b', marginBottom: '6px' }}>
                Quick multi-select (click to toggle tags):
              </small>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {CURATED_CATEGORIES.map((cat) => {
                  const isSel = activeCategories.includes(cat)
                  return (
                    <button
                      type="button"
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '16px',
                        border: isSel ? '1px solid #0878f9' : '1px solid #d9e2ea',
                        background: isSel ? '#eff8ff' : '#fff',
                        color: isSel ? '#0878f9' : '#475569',
                        fontSize: '11px',
                        fontWeight: isSel ? 700 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isSel ? `✓ ${cat}` : `+ ${cat}`}
                    </button>
                  )
                })}
                <button
                  type="button"
                  data-testid="other-category-option"
                  onClick={() => setOtherSelected((selected) => !selected)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '16px',
                    border: otherSelected ? '1px solid #0878f9' : '1px solid #d9e2ea',
                    background: otherSelected ? '#eff8ff' : '#fff',
                    color: otherSelected ? '#0878f9' : '#475569',
                    fontSize: '11px',
                    fontWeight: otherSelected ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {otherSelected ? '✓ Other' : '+ Other'}
                </button>
              </div>
              {otherSelected && (
                <label style={{ display: 'block', marginTop: '10px' }}>
                  Other category details
                  <textarea
                    data-testid="other-category-details"
                    value={otherCategoryDetails}
                    onChange={(event) => setOtherCategoryDetails(event.target.value)}
                    placeholder="Explain the category or problem clearly..."
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
              )}
            </div>
          </div>

          <label className="span-2">
            Description
            <textarea
              name="description"
              value={form.description}
              onChange={({ target: { value } }) =>
                setForm((current) => ({ ...current, description: value }))
              }
              placeholder="Describe what the issue is, who is affected, and any specific details..."
              minLength={30}
              maxLength={10000}
              required
            />
          </label>

          <label className="span-2">
            Evidence image, video, or PDF (optional)
            <input
              data-testid="challenge-evidence-input"
              name="evidence"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf"
              onChange={(event) =>
                setEvidenceFile(event.target.files?.[0] ?? null)
              }
            />
            <small className="field-help">
              Accepted: JPG, PNG, WebP, MP4, or PDF up to 10 MB. AI will analyze uploaded media for summary, priority, and category suggestions for review.
            </small>
          </label>

          {evidenceFile && (
            <label className="span-2">
              Evidence caption
              <input
                name="evidenceCaption"
                value={evidenceCaption}
                onChange={(event) => setEvidenceCaption(event.target.value)}
                placeholder="e.g. Photo taken near gate 2 during morning rush hour"
                maxLength={500}
              />
            </label>
          )}

          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit for review'}
          </button>
        </form>
      )}

      <div className="filters">
        <input
          placeholder="Search challenges or locations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="All">All Categories</option>
          {allAvailableCategories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loading label="Loading challenges…" />
      ) : challenges.length ? (
        <div className="cards">
          {challenges.map((challenge) => {
            const categories = challenge.category.split(',').map((s) => s.trim()).filter(Boolean)

            return (
              <Link
                className="challenge"
                data-challenge-id={challenge.id}
                to={`/challenges/${challenge.id}`}
                key={challenge.id}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span className={`badge ${challenge.priority.toLowerCase()}`}>
                      {challenge.priority}
                    </span>
                    <span className="badge">{challenge.status}</span>
                  </div>
                </div>

                <h2>{challenge.title}</h2>

                {/* Multi-category tags */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '8px 0' }}>
                  {categories.map((cat) => (
                    <span
                      key={cat}
                      style={{
                        fontSize: '10px',
                        background: '#f1f5f9',
                        color: '#475569',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontWeight: 600,
                      }}
                    >
                      {cat}
                    </span>
                  ))}
                </div>

                <p>{challenge.location}</p>

                <div className="progress">
                  <i style={{ width: `${challenge.readiness}%` }} />
                </div>
                <small>
                  {challenge.readiness}% solution readiness • {challenge.teams} teams
                </small>
              </Link>
            )
          })}
        </div>
      ) : (
        <Empty message="No challenges match these filters." />
      )}
    </section>
  )
}
