import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/database.js'
import { requireAuth } from '../lib/auth.js'
import { conflict, notFound, parse } from '../lib/http.js'
import { notify, notifyRole } from '../lib/notifications.js'
import { isTeamMember } from '../lib/ownership.js'

const uuidParams = z.object({ id: z.string().uuid() })
const solutionParams = z.object({ solutionId: z.string().uuid() })
const teamParams = z.object({ teamId: z.string().uuid() })
const createSchema = z.object({
  title: z.string().trim().min(5).max(180),
  description: z.string().trim().min(30).max(15_000),
  repositoryUrl: z.string().url().max(500).optional(),
  demoUrl: z.string().url().max(500).optional(),
})
const legacyCreateSchema = createSchema.extend({ teamId: z.string().uuid() })
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required')
const reviewSchema = z.object({ decision: z.enum(['Approved', 'Changes requested']), feedback: z.string().trim().min(10).max(5000) })
const progressSchema = z.object({
  summary: z.string().trim().min(10).max(5000),
  completionPercent: z.number().int().min(0).max(100),
  blockers: z.string().trim().max(3000).optional(),
  milestoneDate: z.iso.date().optional(),
})
const listSchema = z.object({
  teamId: z.string().uuid().optional(),
  challengeId: z.string().uuid().optional(),
  status: z.enum(['Draft', 'Mentor review', 'Approved', 'Changes requested']).optional(),
  mine: z.coerce.boolean().optional(),
})

const solutionSelect = `
  select s.id, s.title, s.description, s.repository_url as "repositoryUrl", s.demo_url as "demoUrl",
         s.team_id as "teamId", t.name as team, t.challenge_id as "challengeId", c.title as challenge,
         s.created_by as "createdBy", s.status, s.submitted_at as "submittedAt",
         s.reviewed_at as "reviewedAt", s.created_at as "createdAt", s.updated_at as "updatedAt",
         (select r.feedback from solution_reviews r where r.solution_id = s.id order by r.created_at desc limit 1) as feedback
    from solutions s join teams t on t.id = s.team_id join challenges c on c.id = t.challenge_id`

async function createSolution(
  database: Database,
  teamId: string,
  userId: string,
  body: z.infer<typeof createSchema>,
) {
  if (!(await isTeamMember(database, teamId, userId))) return undefined
  const id = randomUUID()
  await database.query(
    `insert into solutions(id, title, description, repository_url, demo_url, team_id, created_by)
     values($1, $2, $3, $4, $5, $6, $7)`,
    [id, body.title, body.description, body.repositoryUrl ?? null, body.demoUrl ?? null, teamId, userId],
  )
  const result = await database.query(`${solutionSelect} where s.id = $1`, [id])
  return result.rows[0]
}

async function solutionAccess(database: Database, id: string) {
  const result = await database.query<{ id: string; team_id: string; status: string; challenge_id: string; title: string }>(
    `select s.id, s.team_id, s.status, t.challenge_id, s.title
       from solutions s join teams t on t.id = s.team_id where s.id = $1`,
    [id],
  )
  return result.rows[0]
}

async function notifyTeam(database: Database, teamId: string, title: string, body: string, solutionId: string) {
  const members = await database.query<{ user_id: string }>('select user_id from team_members where team_id = $1', [teamId])
  await Promise.all(members.rows.map((member) => notify(database, member.user_id, title, body, 'solution', solutionId)))
}

export async function solutionRoutes(app: FastifyInstance, database: Database) {
  app.get('/solutions', { preHandler: requireAuth(database) }, async (request, reply) => {
    const query = parse(listSchema, request.query, reply)
    if (!query) return
    const clauses: string[] = []
    const values: unknown[] = []
    if (query.teamId) { values.push(query.teamId); clauses.push(`s.team_id = $${values.length}`) }
    if (query.challengeId) { values.push(query.challengeId); clauses.push(`t.challenge_id = $${values.length}`) }
    if (query.status) { values.push(query.status); clauses.push(`s.status = $${values.length}`) }
    if (query.mine) { values.push(request.authUser!.id); clauses.push(`exists (select 1 from team_members tm where tm.team_id = s.team_id and tm.user_id = $${values.length})`) }
    const result = await database.query(
      `${solutionSelect} ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by s.created_at desc`,
      values,
    )
    return { items: result.rows }
  })

  app.get('/solutions/:id', { preHandler: requireAuth(database) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const result = await database.query(`${solutionSelect} where s.id = $1`, [params.id])
    const solution = result.rows[0]
    if (!solution) return notFound(reply, 'Solution')
    const reviews = await database.query(
      `select r.id, r.decision, r.feedback, r.created_at as "createdAt", p.id as "reviewerId", p.name as reviewer
         from solution_reviews r join profiles p on p.id = r.reviewer_id
        where r.solution_id = $1 order by r.created_at desc`,
      [params.id],
    )
    return { ...solution, reviews: reviews.rows }
  })

  app.post('/teams/:teamId/solutions', { preHandler: requireAuth(database, ['Student']) }, async (request, reply) => {
    const params = parse(teamParams, request.params, reply)
    const body = parse(createSchema, request.body, reply)
    if (!params || !body) return
    const team = await database.query('select 1 from teams where id = $1', [params.teamId])
    if (!team.rows.length) return notFound(reply, 'Team')
    const solution = await createSolution(database, params.teamId, request.authUser!.id, body)
    if (!solution) return reply.code(403).send({ error: 'forbidden', message: 'Only team members can create a solution for this team.' })
    return reply.code(201).send(solution)
  })

  app.post('/solutions', { preHandler: requireAuth(database, ['Student']) }, async (request, reply) => {
    const body = parse(legacyCreateSchema, request.body, reply)
    if (!body) return
    const { teamId, ...solutionBody } = body
    const team = await database.query('select 1 from teams where id = $1', [teamId])
    if (!team.rows.length) return notFound(reply, 'Team')
    const solution = await createSolution(database, teamId, request.authUser!.id, solutionBody)
    if (!solution) return reply.code(403).send({ error: 'forbidden', message: 'Only team members can create a solution for this team.' })
    return reply.code(201).send(solution)
  })

  app.patch('/solutions/:id', { preHandler: requireAuth(database, ['Student']) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    const body = parse(updateSchema, request.body, reply)
    if (!params || !body) return
    const solution = await solutionAccess(database, params.id)
    if (!solution) return notFound(reply, 'Solution')
    if (!(await isTeamMember(database, solution.team_id, request.authUser!.id))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only team members can edit this solution.' })
    }
    if (!['Draft', 'Changes requested'].includes(solution.status)) return conflict(reply, 'Only draft solutions or solutions with requested changes can be edited.')
    const column: Record<string, string> = { repositoryUrl: 'repository_url', demoUrl: 'demo_url', title: 'title', description: 'description' }
    const fields = Object.entries(body)
    const values = fields.map(([, value]) => value)
    const set = fields.map(([key], index) => `${column[key]} = $${index + 1}`).join(', ')
    values.push(params.id)
    await database.query(`update solutions set ${set}, updated_at = now() where id = $${values.length}`, values)
    const updated = await database.query(`${solutionSelect} where s.id = $1`, [params.id])
    return updated.rows[0]
  })

  app.post('/solutions/:id/submit', { preHandler: requireAuth(database, ['Student']) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const solution = await solutionAccess(database, params.id)
    if (!solution) return notFound(reply, 'Solution')
    if (!(await isTeamMember(database, solution.team_id, request.authUser!.id))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only team members can submit this solution.' })
    }
    if (!['Draft', 'Changes requested'].includes(solution.status)) return conflict(reply, 'This solution is not ready for another submission.')
    await database.query(
      `update solutions set status = 'Mentor review', submitted_at = now(), reviewed_at = null, updated_at = now() where id = $1`,
      [params.id],
    )
    await notifyRole(database, 'Mentor', 'Solution ready for review', solution.title, 'solution', params.id)
    return { id: params.id, status: 'Mentor review' }
  })

  app.patch('/solutions/:id/review', { preHandler: requireAuth(database, ['Mentor', 'Admin']) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    const body = parse(reviewSchema, request.body, reply)
    if (!params || !body) return
    const solution = await solutionAccess(database, params.id)
    if (!solution) return notFound(reply, 'Solution')
    if (solution.status !== 'Mentor review') return conflict(reply, 'Only solutions awaiting mentor review can be reviewed.')
    await database.query(
      `insert into solution_reviews(id, solution_id, reviewer_id, decision, feedback)
       values($1, $2, $3, $4, $5)`,
      [randomUUID(), params.id, request.authUser!.id, body.decision, body.feedback],
    )
    await database.query(
      'update solutions set status = $1, reviewed_at = now(), updated_at = now() where id = $2',
      [body.decision, params.id],
    )
    await notifyTeam(database, solution.team_id, 'Solution review completed', `${solution.title}: ${body.decision}.`, params.id)
    return { id: params.id, status: body.decision, feedback: body.feedback }
  })

  app.get('/solutions/:solutionId/progress', { preHandler: requireAuth(database) }, async (request, reply) => {
    const params = parse(solutionParams, request.params, reply)
    if (!params) return
    const solution = await solutionAccess(database, params.solutionId)
    if (!solution) return notFound(reply, 'Solution')
    const result = await database.query(
      `select u.id, u.summary, u.completion_percent as "completionPercent", u.blockers,
              u.milestone_date as "milestoneDate", u.created_at as "createdAt", p.name as author
         from progress_updates u join profiles p on p.id = u.author_id
        where u.solution_id = $1 order by u.created_at desc`,
      [params.solutionId],
    )
    return { items: result.rows.map((row) => ({ ...row, completionPercent: Number(row.completionPercent) })) }
  })

  app.post('/solutions/:solutionId/progress', { preHandler: requireAuth(database, ['Student']) }, async (request, reply) => {
    const params = parse(solutionParams, request.params, reply)
    const body = parse(progressSchema, request.body, reply)
    if (!params || !body) return
    const solution = await solutionAccess(database, params.solutionId)
    if (!solution) return notFound(reply, 'Solution')
    if (!(await isTeamMember(database, solution.team_id, request.authUser!.id))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only team members can post progress for this solution.' })
    }
    const id = randomUUID()
    await database.query(
      `insert into progress_updates(id, solution_id, author_id, summary, completion_percent, blockers, milestone_date)
       values($1, $2, $3, $4, $5, $6, $7)`,
      [id, params.solutionId, request.authUser!.id, body.summary, body.completionPercent, body.blockers ?? null, body.milestoneDate ?? null],
    )
    await database.query(
      `update challenges set readiness = greatest(readiness, $1), updated_at = now() where id = $2`,
      [body.completionPercent, solution.challenge_id],
    )
    return reply.code(201).send({ id, ...body, createdAt: new Date().toISOString() })
  })
}
