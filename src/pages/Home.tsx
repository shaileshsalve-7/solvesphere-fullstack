import type { LucideIcon } from 'lucide-react'
import { ArrowRight, ShieldCheck, Sparkles, Target, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'

const features: Array<{ Icon: LucideIcon; title: string; description: string }> = [
  { Icon: Target, title: 'Report challenges', description: 'Capture civic problems with location, evidence and priority.' },
  { Icon: Users, title: 'Build teams', description: 'Students collaborate with peers and mentors around real needs.' },
  { Icon: ShieldCheck, title: 'Review & govern', description: 'Mentors and admins track progress, quality and impact.' },
  { Icon: Sparkles, title: 'Measure impact', description: 'Move every challenge from report to verified outcome.' },
]

export function Home() {
  return <div className="public-page">
    <header className="public-nav">
      <Link to="/" className="brand"><Logo/><span><b>SolveSphere</b><small>Identify. Connect. Solve.</small></span></Link>
      <div className="actions"><Link to="/challenges">Explore challenges</Link><Link to="/login">Sign in</Link><Link className="btn btn-primary" to="/signup">Create account <ArrowRight size={15}/></Link></div>
    </header>
    <section className="hero">
      <div><span className="eyebrow">SIH26043 • Civic innovation</span><h1>Turn real-world problems into <em>measurable solutions.</em></h1><p>SolveSphere connects citizens who report problems with students, mentors and teams who can build practical solutions.</p><div className="hero-actions"><Link className="btn btn-primary" to="/signup">Start solving <ArrowRight size={16}/></Link><Link className="text-link" to="/challenges">View challenges</Link></div></div>
      <div className="hero-card"><Logo size={180}/><div><strong>Identify Problems.</strong><br/>Connect People. Build Solutions. Create Measurable Impact.</div></div>
    </section>
    <section className="features">{features.map(({ Icon, title, description }) => <article key={title}><Icon size={22}/><h3>{title}</h3><p>{description}</p></article>)}</section>
  </div>
}
