import type { Database } from '../db/database.js'
import type { AuthUser } from './auth.js'

export async function isTeamMember(database: Database, teamId: string, userId: string) {
  const result = await database.query(
    'select 1 as allowed from team_members where team_id = $1 and user_id = $2',
    [teamId, userId],
  )
  return result.rows.length > 0
}

export async function canContributeEvidence(database: Database, challengeId: string, user: AuthUser) {
  if (user.role === 'Admin') return true
  const result = await database.query(
    `select 1 as allowed
       from challenges c
      where c.id = $1
        and (c.owner_id = $2 or exists (
          select 1 from teams t join team_members tm on tm.team_id = t.id
           where t.challenge_id = c.id and tm.user_id = $2
        ))`,
    [challengeId, user.id],
  )
  return result.rows.length > 0
}

export async function canViewChallenge(database: Database, challengeId: string, user: AuthUser | null) {
  const challenge = await database.query<{ status: string; owner_id: string }>(
    'select status, owner_id from challenges where id = $1',
    [challengeId],
  )
  const record = challenge.rows[0]
  if (!record) return false
  if (['Open', 'In progress', 'Submitted', 'Resolved'].includes(record.status)) return true
  if (!user) return false
  if (user.role === 'Admin' || record.owner_id === user.id) return true
  const membership = await database.query(
    `select 1 from teams t join team_members tm on tm.team_id = t.id
      where t.challenge_id = $1 and tm.user_id = $2`,
    [challengeId, user.id],
  )
  return membership.rows.length > 0
}
