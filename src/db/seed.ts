import { hash } from 'bcryptjs'
import type { AppConfig } from '../config.js'
import type { Database } from './database.js'

const adminId = '00000000-0000-4000-8000-000000000001'

const demoChallenges = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Dangerous potholes on the main school road',
    description: 'Deep potholes near the school entrance slow emergency vehicles and put cyclists, students, and two-wheeler riders at daily risk.',
    category: 'Roads & Infrastructure', location: 'Kothrud, Pune, Maharashtra', priority: 'Critical',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    title: 'Overflowing community waste collection point',
    description: 'Mixed waste regularly overflows beside the market, attracting animals and creating unsafe conditions for nearby homes and vendors.',
    category: 'Waste Management', location: 'Hadapsar, Pune, Maharashtra', priority: 'High',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    title: 'Recurring drinking-water leakage in the colony',
    description: 'A damaged municipal supply line loses clean water every morning and leaves the pedestrian lane wet, slippery, and difficult to use.',
    category: 'Water & Sanitation', location: 'Aundh, Pune, Maharashtra', priority: 'High',
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    title: 'Non-functional streetlights around the bus stop',
    description: 'Several streetlights near the bus stop have remained dark for weeks, reducing visibility and making evening travel feel unsafe.',
    category: 'Public Safety', location: 'Baner, Pune, Maharashtra', priority: 'High',
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    title: 'Unsafe traffic congestion at the hospital junction',
    description: 'Uncoordinated signals and roadside parking block ambulances during peak hours and create frequent conflicts between vehicles and pedestrians.',
    category: 'Traffic & Mobility', location: 'Shivajinagar, Pune, Maharashtra', priority: 'Critical',
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    title: 'Neighbourhood park needs safe and accessible renewal',
    description: 'Broken play equipment, damaged pathways, and poor seating prevent children, older residents, and wheelchair users from using the public park safely.',
    category: 'Parks & Accessibility', location: 'Viman Nagar, Pune, Maharashtra', priority: 'Medium',
  },
] as const

export async function seedDevelopmentData(database: Database, config: AppConfig) {
  if (config.nodeEnv === 'production' || !config.devSeedEnabled) return

  const existing = await database.query<{ id: string; role: string; password_hash: string | null }>(
    'select id, role, password_hash from profiles where email = $1',
    [config.devAdminEmail],
  )
  let ownerId: string
  if (existing.rows[0]) {
    const account = existing.rows[0]
    if (account.role !== 'Admin') {
      throw new Error('DEV_ADMIN_EMAIL belongs to a non-admin account; choose a different development email')
    }
    ownerId = account.id
    if (!account.password_hash) {
      const passwordHash = await hash(config.devAdminPassword!, config.nodeEnv === 'test' ? 4 : 12)
      await database.query(
        `update profiles set password_hash = $1, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
          where id = $2 and password_hash is null`,
        [passwordHash, ownerId],
      )
    }
  } else {
    const passwordHash = await hash(config.devAdminPassword!, config.nodeEnv === 'test' ? 4 : 12)
    await database.query(
      `insert into profiles(id, email, name, role, password_hash, email_verified_at)
       values($1, $2, 'SolveSphere Admin', 'Admin', $3, now())`,
      [adminId, config.devAdminEmail, passwordHash],
    )
    ownerId = adminId
  }

  for (const challenge of demoChallenges) {
    await database.query(
      `insert into challenges(id, title, description, category, location, status, priority, readiness, owner_id)
       values($1, $2, $3, $4, $5, 'Published', $6, 0, $7)
       on conflict(id) do nothing`,
      [challenge.id, challenge.title, challenge.description, challenge.category, challenge.location, challenge.priority, ownerId],
    )
    const historyId = challenge.id.replace(/^10000000/, '20000000')
    await database.query(
      `insert into challenge_status_history(id, challenge_id, from_status, to_status, reason, changed_by)
       values($1, $2, null, 'Published', 'Development demo challenge', $3)
       on conflict(id) do nothing`,
      [historyId, challenge.id, ownerId],
    )
  }
}
