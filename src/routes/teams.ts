import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/database.js'
import { requireAuth } from '../lib/auth.js'
import { conflict, notFound, parse } from '../lib/http.js'
import { notify, notifyTeamMembers } from '../lib/notifications.js'
import { canViewChallenge, isTeamMember } from '../lib/ownership.js'

const uuidParams = z.object({ id: z.string().uuid() })
const challengeParams = z.object({ challengeId: z.string().uuid() })
const createSchema = z.object({ name: z.string().trim().min(3).max(100) })
const listSchema = z.object({ challengeId: z.string().uuid().optional() })

const teamSelect = `
  select t.id, t.name, t.challenge_id as "challengeId", c.title as challenge,
         c.status as "challengeStatus", t.owner_id as "ownerId", p.name as owner, t.status,
         t.created_at as "createdAt", t.updated_at as "updatedAt",
         (select count(*) from team_members tm where tm.team_id = t.id) as members
    from teams t join challenges c on c.id = t.challenge_id join profiles p on p.id = t.owner_id`

function shape(row: Record<string, unknown>) {
  return { ...row, members: Number(row.members ?? 0) }
}

export async function teamRoutes(app: FastifyInstance, database: Database) {
  app.get('/teams', { preHandler: requireAuth(database) }, async (request, reply) => {
    const query = parse(listSchema, request.query, reply)
    if (!query) return
    const clauses: string[] = []
    const values: unknown[] = []
    if (query.challengeId) { values.push(query.challengeId); clauses.push(`t.challenge_id = $${values.length}`) }
    if (request.authUser!.role !== 'Admin') {
      values.push(request.authUser!.id)
      clauses.push(`(
        c.status in ('Published', 'In progress', 'Implemented')
        or c.owner_id = $${values.length}
        or exists(select 1 from team_members visible_tm where visible_tm.team_id = t.id and visible_tm.user_id = $${values.length})
      )`)
    }
    const result = await database.query(
      `${teamSelect} ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by t.created_at desc`,
      values,
    )
    return { items: result.rows.map(shape) }
  })

  app.get('/teams/:id', { preHandler: requireAuth(database) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const result = await database.query(`${teamSelect} where t.id = $1`, [params.id])
    const team = result.rows[0]
    if (!team) return notFound(reply, 'Team')
    const challengeId = String((team as Record<string, unknown>).challengeId)
    if (!await canViewChallenge(database, challengeId, request.authUser)) return notFound(reply, 'Team')
    const members = await database.query(
      `select p.id, p.name, p.role, tm.member_role as "memberRole", tm.joined_at as "joinedAt"
         from team_members tm join profiles p on p.id = tm.user_id
        where tm.team_id = $1 order by tm.joined_at`,
      [params.id],
    )
    return { ...shape(team), memberList: members.rows }
  })

  app.post('/challenges/:challengeId/teams', { preHandler: requireAuth(database, ['Student']) }, async (request, reply) => {
    const params = parse(challengeParams, request.params, reply)
    const body = parse(createSchema, request.body, reply)
    if (!params || !body) return
    const id = randomUUID()
    try {
      const outcome = await database.transaction(async (transaction) => {
        const challengeResult = await transaction.query<{ status: string; owner_id: string; title: string }>(
          'select status, owner_id, title from challenges where id = $1 for update',
          [params.challengeId],
        )
        const challenge = challengeResult.rows[0]
        if (!challenge) return { kind: 'missing' as const }
        if (!['Published', 'In progress'].includes(challenge.status)) return { kind: 'closed' as const }
        await transaction.query(
          `insert into teams(id, name, challenge_id, owner_id) values($1, $2, $3, $4)`,
          [id, body.name, params.challengeId, request.authUser!.id],
        )
        await transaction.query(
          `insert into team_members(team_id, user_id, member_role) values($1, $2, 'Owner')`,
          [id, request.authUser!.id],
        )
        if (challenge.status === 'Published') {
          await transaction.query(`update challenges set status = 'In progress', updated_at = now() where id = $1 and status = 'Published'`, [params.challengeId])
          await transaction.query(
            `insert into challenge_status_history(id, challenge_id, from_status, to_status, reason, changed_by)
             values($1, $2, 'Published', 'In progress', 'First team created', $3)`,
            [randomUUID(), params.challengeId, request.authUser!.id],
          )
        }
        await notify(transaction, challenge.owner_id, 'A team joined your challenge', `${body.name} started working on ${challenge.title}.`, 'team', id)
        const created = await transaction.query(`${teamSelect} where t.id = $1`, [id])
        return { kind: 'created' as const, team: shape(created.rows[0]!) }
      })
      if (outcome.kind === 'missing') return notFound(reply, 'Challenge')
      if (outcome.kind === 'closed') return conflict(reply, 'Teams can only be formed for open or in-progress challenges.')
      return reply.code(201).send(outcome.team)
    } catch (error) {
      if (String(error).toLowerCase().includes('unique')) return conflict(reply, 'A team with this name already exists for the challenge.')
      throw error
    }
  })

  app.post('/teams/:id/join', { preHandler: requireAuth(database, ['Student']) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const result = await database.query<{ status: string; owner_id: string; name: string; challenge_id: string; challenge_status: string }>(
      `select t.status, t.owner_id, t.name, t.challenge_id, c.status as challenge_status
         from teams t join challenges c on c.id = t.challenge_id where t.id = $1`,
      [params.id],
    )
    const team = result.rows[0]
    if (!team) return notFound(reply, 'Team')
    if (!['Published', 'In progress'].includes(team.challenge_status) && !(await isTeamMember(database, params.id, request.authUser!.id))) {
      return notFound(reply, 'Team')
    }
    if (team.status !== 'Active') return conflict(reply, 'This team is not accepting members.')
    if (!['Published', 'In progress'].includes(team.challenge_status)) return conflict(reply, 'This challenge is not accepting new team members.')
    if (await isTeamMember(database, params.id, request.authUser!.id)) return conflict(reply, 'You are already a member of this team.')
    await database.query('insert into team_members(team_id, user_id) values($1, $2)', [params.id, request.authUser!.id])
    await notifyTeamMembers(
      database,
      params.id,
      'New team member',
      `${request.authUser!.name} joined ${team.name}.`,
      'team',
      params.id,
      request.authUser!.id,
    )
    return reply.code(201).send({ teamId: params.id, userId: request.authUser!.id, memberRole: 'Member' })
  })

  app.delete('/teams/:id/members/me', { preHandler: requireAuth(database, ['Student']) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const result = await database.query<{ owner_id: string }>('select owner_id from teams where id = $1', [params.id])
    const team = result.rows[0]
    if (!team) return notFound(reply, 'Team')
    if (team.owner_id === request.authUser!.id) return conflict(reply, 'A team owner cannot leave without transferring ownership or closing the team.')
    const deleted = await database.query('delete from team_members where team_id = $1 and user_id = $2', [params.id, request.authUser!.id])
    if (!deleted.affectedRows) return notFound(reply, 'Team membership')
    await notifyTeamMembers(database, params.id, 'Team member left', `${request.authUser!.name} left the team.`, 'team', params.id)
    return reply.code(204).send()
  })
}
