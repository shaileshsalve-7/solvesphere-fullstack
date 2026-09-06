import { randomUUID } from 'node:crypto'
import type { Database } from '../db/database.js'

export async function notify(
  database: Database,
  userId: string,
  title: string,
  body: string,
  resourceType?: string,
  resourceId?: string,
) {
  await database.query(
    `insert into notifications(id, user_id, title, body, resource_type, resource_id)
     values($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), userId, title, body, resourceType ?? null, resourceId ?? null],
  )
}

export async function notifyRole(
  database: Database,
  role: string,
  title: string,
  body: string,
  resourceType?: string,
  resourceId?: string,
) {
  const users = await database.query<{ id: string }>('select id from profiles where role = $1', [role])
  for (const user of users.rows) await notify(database, user.id, title, body, resourceType, resourceId)
}

export async function notifyTeamMembers(
  database: Database,
  teamId: string,
  title: string,
  body: string,
  resourceType?: string,
  resourceId?: string,
  excludeUserId?: string,
) {
  const members = await database.query<{ user_id: string }>(
    'select user_id from team_members where team_id = $1',
    [teamId],
  )
  const recipients = [...new Set(members.rows.map((member) => member.user_id))]
    .filter((userId) => userId !== excludeUserId)
  for (const userId of recipients) await notify(database, userId, title, body, resourceType, resourceId)
}
