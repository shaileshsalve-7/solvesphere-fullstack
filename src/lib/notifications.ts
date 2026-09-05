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
  await Promise.all(users.rows.map((user) => notify(database, user.id, title, body, resourceType, resourceId)))
}
