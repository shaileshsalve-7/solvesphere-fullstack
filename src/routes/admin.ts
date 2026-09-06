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
    const [users, challenges, teams, solutions, reviews, evidence, progress] = await Promise.all([
      database.query<{ role: string; count: number }>('select role, count(*)::int as count from profiles group by role order by role'),
      database.query<{ status: string; count: number }>('select status, count(*)::int as count from challenges group by status order by status'),
      database.query<{ count: number }>("select count(*)::int as count from teams where status = 'Active'"),
      database.query<{ status: string; count: number }>('select status, count(*)::int as count from solutions group by status order by status'),
      database.query<{ count: number }>('select count(*)::int as count from solution_reviews'),
      database.query<{ count: number }>('select count(*)::int as count from challenge_evidence'),
      database.query<{ count: number }>('select count(*)::int as count from progress_updates'),
    ])
    return {
      usersByRole: users.rows,
      challengesByStatus: challenges.rows,
      activeTeams: Number(teams.rows[0]?.count ?? 0),
      solutionsByStatus: solutions.rows,
      totalUsers: users.rows.reduce((total, row) => total + Number(row.count), 0),
      totalChallenges: challenges.rows.reduce((total, row) => total + Number(row.count), 0),
      totalSolutions: solutions.rows.reduce((total, row) => total + Number(row.count), 0),
      totalReviews: Number(reviews.rows[0]?.count ?? 0),
      evidenceFiles: Number(evidence.rows[0]?.count ?? 0),
      progressUpdates: Number(progress.rows[0]?.count ?? 0),
    }
  })

  app.get('/admin/challenges', { preHandler: requireAuth(database, ['Admin']) }, async () => {
    const result = await database.query(
      `select c.id, c.title, c.description, c.category, c.location, c.status, c.priority, c.readiness,
              c.owner_id as "ownerId", p.name as owner, p.email as "ownerEmail",
              c.created_at as "createdAt", c.updated_at as "updatedAt",
              (select count(*)::int from teams t where t.challenge_id = c.id) as teams,
              (select count(*)::int from challenge_evidence e where e.challenge_id = c.id) as evidence
         from challenges c join profiles p on p.id = c.owner_id
        order by c.created_at desc`,
    )
    return { items: result.rows }
  })

  app.get('/admin/teams', { preHandler: requireAuth(database, ['Admin']) }, async () => {
    const result = await database.query(
      `select t.id, t.name, t.challenge_id as "challengeId", c.title as challenge,
              t.owner_id as "ownerId", p.name as owner, p.email as "ownerEmail", t.status,
              t.created_at as "createdAt", t.updated_at as "updatedAt",
              (select count(*)::int from team_members tm where tm.team_id = t.id) as members,
              (select count(*)::int from solutions s where s.team_id = t.id) as solutions
         from teams t join challenges c on c.id = t.challenge_id join profiles p on p.id = t.owner_id
        order by t.created_at desc`,
    )
    return { items: result.rows }
  })

  app.get('/admin/solutions', { preHandler: requireAuth(database, ['Admin']) }, async () => {
    const result = await database.query(
      `select s.id, s.title, s.description, s.repository_url as "repositoryUrl", s.demo_url as "demoUrl",
              s.team_id as "teamId", t.name as team, t.challenge_id as "challengeId", c.title as challenge,
              s.created_by as "createdBy", p.name as creator, p.email as "creatorEmail", s.status,
              s.submitted_at as "submittedAt", s.reviewed_at as "reviewedAt",
              s.created_at as "createdAt", s.updated_at as "updatedAt",
              (select count(*)::int from solution_reviews r where r.solution_id = s.id) as "reviewCount",
              (select r.feedback from solution_reviews r where r.solution_id = s.id order by r.created_at desc limit 1) as "latestFeedback"
         from solutions s
         join teams t on t.id = s.team_id
         join challenges c on c.id = t.challenge_id
         join profiles p on p.id = s.created_by
        order by s.created_at desc`,
    )
    return { items: result.rows }
  })

  app.get('/admin/reviews', { preHandler: requireAuth(database, ['Admin']) }, async () => {
    const result = await database.query(
      `select r.id, r.solution_id as "solutionId", s.title as solution,
              r.reviewer_id as "reviewerId", p.name as reviewer, p.email as "reviewerEmail",
              r.decision, r.feedback, s.team_id as "teamId", t.challenge_id as "challengeId",
              r.created_at as "createdAt"
         from solution_reviews r
         join solutions s on s.id = r.solution_id
         join teams t on t.id = s.team_id
         join profiles p on p.id = r.reviewer_id
        order by r.created_at desc`,
    )
    return { items: result.rows }
  })
}
