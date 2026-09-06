import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { useAuth } from '../context/AuthContext'
import { apiError, challengeApi, teamApi } from '../services/api'
import type { Challenge, Team } from '../types'

type Evidence = { id: string; originalName: string; mimeType: string; sizeBytes: number; caption?: string; uploadedBy: string; createdAt: string }

export function ChallengeDetails() {
  const { id } = useParams()
  const { user } = useAuth()
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError('')
    try {
      const [nextChallenge, listedTeams, nextEvidence] = await Promise.all([challengeApi.get(id), teamApi.list(id), challengeApi.evidence(id)])
      const detailedTeams = await Promise.all(listedTeams.map((team) => teamApi.get(team.id)))
      setChallenge(nextChallenge); setTeams(detailedTeams); setEvidence(nextEvidence)
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { void load() }, [load])

  async function join(teamId: string) {
    setBusy(true); setError(''); setSuccess('')
    try { await teamApi.join(teamId); setSuccess('You joined the team.'); await load() }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault()
    if (!id || !file) return
    setBusy(true); setError(''); setSuccess('')
    try { await challengeApi.uploadEvidence(id, file, caption); setFile(null); setCaption(''); setSuccess('Evidence uploaded.'); await load() }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  async function download(item: Evidence) {
    setBusy(true); setError(''); setSuccess('')
    try {
      const blob = await challengeApi.downloadEvidence(item.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = item.originalName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setBusy(false) }
  }

  if (loading) return <Loading label="Loading challenge…"/>
  if (!challenge) return <section className="page"><ErrorBanner message={error || 'Challenge not found.'}/><Link to="/challenges">Back to challenges</Link></section>
  const memberTeamIds = new Set(teams.filter((team) => team.memberList?.some((member) => member.id === user?.id)).map((team) => team.id))
  const canUploadEvidence = challenge.ownerId === user?.id || user?.role === 'Admin' || memberTeamIds.size > 0

  return <section className="page">
    <Link className="text-link" to="/challenges">← Back to challenges</Link>
    {error && <ErrorBanner message={error}/>}
    {success && <SuccessBanner message={success}/>}
    <div className="panel detail">
      <div><span className={`badge ${challenge.priority.toLowerCase()}`}>{challenge.priority}</span> <span className="badge">{challenge.status}</span></div>
      <h1>{challenge.title}</h1><p>{challenge.category} • {challenge.location}</p><p>{challenge.description}</p>
      <p>Reported by {challenge.owner}. This challenge has {challenge.teams} teams and {challenge.evidence} evidence items.</p>
      <div className="progress"><i style={{ width: `${challenge.readiness}%` }}/></div><strong>{challenge.readiness}% solution readiness</strong>
    </div>
    <div className="grid section-gap">
      <div className="panel"><h2>Teams working on this challenge</h2>{teams.length ? teams.map((team) => <div className="row" key={team.id}><div><b>{team.name}</b><small>{team.members} members • led by {team.owner}</small></div>{user?.role === 'Student' && (memberTeamIds.has(team.id) ? <span className="badge">Joined</span> : <button className="btn btn-secondary" aria-label={`Join ${team.name}`} onClick={() => join(team.id)} disabled={busy}>Join</button>)}</div>) : <Empty message="No team has started yet."/>}</div>
      <div className="panel"><h2>Evidence</h2>{evidence.length ? evidence.map((item) => <div className="row" key={item.id}><div><b>{item.originalName}</b><small>{item.caption || item.mimeType} • {Math.ceil(item.sizeBytes / 1024)} KB</small></div><button className="btn btn-secondary" data-action="download-evidence" onClick={() => download(item)} disabled={busy}>Download</button></div>) : <Empty message="No evidence uploaded yet."/>}
        {canUploadEvidence && <form className="compact-form" onSubmit={upload}><label>Add evidence<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required/></label><label>Caption<input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500}/></label><button className="btn btn-secondary" disabled={busy || !file}>Upload</button></form>}
      </div>
    </div>
  </section>
}
