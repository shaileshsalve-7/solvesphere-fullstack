import { useCallback, useEffect, useState } from 'react'
import { Empty, ErrorBanner, Loading, SuccessBanner } from '../components/States'
import { accountApi, apiError } from '../services/api'
import type { Notification } from '../types'

export function Notifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setItems(await accountApi.notifications()) }
    catch (requestError) { setError(apiError(requestError)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function read(id: string) {
    try { await accountApi.readNotification(id); await load() } catch (requestError) { setError(apiError(requestError)) }
  }
  async function readAll() {
    try { const result = await accountApi.readAll(); setSuccess(`${result.updated} notifications marked as read.`); await load() } catch (requestError) { setError(apiError(requestError)) }
  }

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">Stay informed</span><h1>Notifications</h1><p>Keep track of challenge, team and review activity.</p></div><button className="btn btn-secondary" onClick={readAll}>Mark all read</button></div>
    {error && <ErrorBanner message={error}/>}
    {success && <SuccessBanner message={success}/>}
    {loading ? <Loading/> : items.length ? <div className="panel">{items.map((item) => <div className={`row notification ${item.readAt ? '' : 'unread'}`} data-notification-id={item.id} key={item.id}><div><b>{item.title}</b><small>{item.body} • {new Date(item.createdAt).toLocaleString()}</small></div>{!item.readAt && <button className="btn btn-secondary" data-action="read-notification" onClick={() => read(item.id)}>Mark read</button>}</div>)}</div> : <Empty message="You have no notifications."/>}
  </section>
}
