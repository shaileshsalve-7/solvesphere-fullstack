import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/database.js'
import { requireAuth } from '../lib/auth.js'
import { notFound, parse } from '../lib/http.js'

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required')
const uuidParams = z.object({ id: z.string().uuid() })

export async function accountRoutes(app: FastifyInstance, database: Database) {
  app.get('/profiles/me', { preHandler: requireAuth(database) }, async (request) => {
    const result = await database.query(
      `select id, email, name, role, avatar_url as "avatarUrl", created_at as "createdAt", updated_at as "updatedAt"
         from profiles where id = $1`,
      [request.authUser!.id],
    )
    return result.rows[0]
  })

  app.patch('/profiles/me', { preHandler: requireAuth(database) }, async (request, reply) => {
    const body = parse(profileSchema, request.body, reply)
    if (!body) return
    const updates: string[] = []
    const values: unknown[] = []
    if (body.name !== undefined) { values.push(body.name); updates.push(`name = $${values.length}`) }
    if (body.avatarUrl !== undefined) { values.push(body.avatarUrl); updates.push(`avatar_url = $${values.length}`) }
    values.push(request.authUser!.id)
    const result = await database.query(
      `update profiles set ${updates.join(', ')}, updated_at = now() where id = $${values.length}
       returning id, email, name, role, avatar_url as "avatarUrl", created_at as "createdAt", updated_at as "updatedAt"`,
      values,
    )
    return result.rows[0]
  })

  app.get('/notifications', { preHandler: requireAuth(database) }, async (request) => {
    const result = await database.query(
      `select id, title, body, resource_type as "resourceType", resource_id as "resourceId",
              read_at as "readAt", created_at as "createdAt"
         from notifications where user_id = $1 order by created_at desc limit 100`,
      [request.authUser!.id],
    )
    return { items: result.rows }
  })

  app.patch('/notifications/:id/read', { preHandler: requireAuth(database) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const result = await database.query(
      `update notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2 returning id, read_at as "readAt"`,
      [params.id, request.authUser!.id],
    )
    if (!result.rows[0]) return notFound(reply, 'Notification')
    return result.rows[0]
  })

  app.patch('/notifications/read-all', { preHandler: requireAuth(database) }, async (request) => {
    const result = await database.query(
      'update notifications set read_at = coalesce(read_at, now()) where user_id = $1 and read_at is null',
      [request.authUser!.id],
    )
    return { updated: result.affectedRows }
  })

  app.get('/dashboard', { preHandler: requireAuth(database) }, async (request) => {
    const [challengeCounts, teamCounts, solutionCounts, unread] = await Promise.all([
      database.query<{ total: number; critical: number; open: number }>(
        `select count(*)::int as total,
                count(*) filter (where priority = 'Critical')::int as critical,
                count(*) filter (where status in ('Published', 'In progress'))::int as open
           from challenges`,
      ),
      database.query<{ total: number; mine: number }>(
        `select count(*)::int as total,
                count(*) filter (where exists (select 1 from team_members tm where tm.team_id = teams.id and tm.user_id = $1))::int as mine
           from teams where status = 'Active'`,
        [request.authUser!.id],
      ),
      database.query<{ total: number; awaiting_review: number; mine: number }>(
        `select count(*)::int as total,
                count(*) filter (where s.status = 'Mentor review')::int as awaiting_review,
                count(*) filter (where exists (select 1 from team_members tm where tm.team_id = s.team_id and tm.user_id = $1))::int as mine
           from solutions s`,
        [request.authUser!.id],
      ),
      database.query<{ count: number }>('select count(*)::int as count from notifications where user_id = $1 and read_at is null', [request.authUser!.id]),
    ])
    return {
      role: request.authUser!.role,
      challenges: challengeCounts.rows[0],
      teams: teamCounts.rows[0],
      solutions: solutionCounts.rows[0],
      unreadNotifications: Number(unread.rows[0]?.count ?? 0),
    }
  })
}
