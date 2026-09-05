import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/database.js'
import { requireAuth } from '../lib/auth.js'
import { conflict, notFound, parse } from '../lib/http.js'
import { notify } from '../lib/notifications.js'

const uuidParams = z.object({ id: z.string().uuid() })
const roleSchema = z.object({ role: z.enum(['Citizen', 'Student', 'Mentor', 'Admin']) })

export async function adminRoutes(app: FastifyInstance, database: Database) {
  app.get('/admin/users', { preHandler: requireAuth(database, ['Admin']) }, async () => {
    const result = await database.query(
      `select id, email, name, role, avatar_url as "avatarUrl", created_at as "createdAt", updated_at as "updatedAt"
         from profiles order by created_at desc`,
    )
    return { items: result.rows }
  })

  app.patch('/admin/users/:id/role', { preHandler: requireAuth(database, ['Admin']) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    const body = parse(roleSchema, request.body, reply)
    if (!params || !body) return
    if (params.id === request.authUser!.id && body.role !== 'Admin') {
      return conflict(reply, 'An administrator cannot remove their own administrator role.')
    }
    const result = await database.query<{ id: string; role: string }>(
      `update profiles set role = $1, updated_at = now() where id = $2 returning id, role`,
      [body.role, params.id],
    )
    const user = result.rows[0]
    if (!user) return notFound(reply, 'User')
    await notify(database, params.id, 'Account role updated', `Your SolveSphere role is now ${body.role}.`, 'profile', params.id)
    return user
  })

  app.get('/admin/overview', { preHandler: requireAuth(database, ['Admin']) }, async () => {
    const [users, challenges, teams, solutions] = await Promise.all([
      database.query<{ role: string; count: number }>('select role, count(*)::int as count from profiles group by role order by role'),
      database.query<{ status: string; count: number }>('select status, count(*)::int as count from challenges group by status order by status'),
      database.query<{ count: number }>("select count(*)::int as count from teams where status = 'Active'"),
      database.query<{ status: string; count: number }>('select status, count(*)::int as count from solutions group by status order by status'),
    ])
    return {
      usersByRole: users.rows,
      challengesByStatus: challenges.rows,
      activeTeams: Number(teams.rows[0]?.count ?? 0),
      solutionsByStatus: solutions.rows,
    }
  })
}
