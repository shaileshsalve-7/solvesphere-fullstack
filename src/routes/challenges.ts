import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../config.js'
import type { Database } from '../db/database.js'
import { optionalAuth, requireAuth } from '../lib/auth.js'
import { conflict, notFound, parse } from '../lib/http.js'
import { notify, notifyRole } from '../lib/notifications.js'
import { canContributeEvidence, canViewChallenge } from '../lib/ownership.js'

const challengeStatuses = ['Under review', 'Open', 'In progress', 'Submitted', 'Resolved', 'Denied'] as const
const priorities = ['Low', 'Medium', 'High', 'Critical'] as const
const uuidParams = z.object({ id: z.string().uuid() })
const createSchema = z.object({
  title: z.string().trim().min(8).max(180),
  description: z.string().trim().min(30).max(10_000),
  category: z.string().trim().min(2).max(80),
  location: z.string().trim().min(2).max(180),
  priority: z.enum(priorities).default('Medium'),
})
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required')
const statusSchema = z.object({ status: z.enum(challengeStatuses), reason: z.string().trim().max(1000).optional() })
const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(challengeStatuses).optional(),
  priority: z.enum(priorities).optional(),
  category: z.string().trim().max(80).optional(),
  mine: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

const transitions: Record<string, string[]> = {
  'Under review': ['Open', 'Denied'],
  Open: ['In progress', 'Denied'],
  'In progress': ['Submitted', 'Resolved', 'Denied'],
  Submitted: ['Resolved', 'In progress', 'Denied'],
  Denied: ['Under review'],
  Resolved: [],
}

function shapeChallenge(row: Record<string, unknown>) {
  return {
    ...row,
    readiness: Number(row.readiness),
    teams: Number(row.teams ?? 0),
    evidence: Number(row.evidence ?? 0),
  }
}

function contentMatchesMime(mimeType: string, buffer: Buffer) {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (mimeType === 'video/mp4') return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  return false
}

const challengeSelect = `
  select c.id, c.title, c.description, c.category, c.location, c.status, c.priority, c.readiness,
         c.owner_id as "ownerId", p.name as owner, c.created_at as "createdAt", c.updated_at as "updatedAt",
         (select count(*) from teams t where t.challenge_id = c.id and t.status = 'Active') as teams,
         (select count(*) from challenge_evidence e where e.challenge_id = c.id) as evidence
    from challenges c join profiles p on p.id = c.owner_id`

export async function challengeRoutes(app: FastifyInstance, database: Database, config: AppConfig) {
  app.get('/challenges', { preHandler: optionalAuth(database) }, async (request, reply) => {
    const query = parse(listSchema, request.query, reply)
    if (!query) return
    const clauses: string[] = []
    const params: unknown[] = []
    if (query.mine) {
      if (!request.authUser) return reply.code(401).send({ error: 'unauthorized', message: 'Sign in to view your challenges.' })
      params.push(request.authUser.id)
      clauses.push(`c.owner_id = $${params.length}`)
    } else {
      clauses.push(`c.status in ('Open', 'In progress', 'Submitted', 'Resolved')`)
    }
    if (query.q) {
      params.push(`%${query.q}%`)
      clauses.push(`(c.title ilike $${params.length} or c.description ilike $${params.length} or c.location ilike $${params.length})`)
    }
    if (query.status) { params.push(query.status); clauses.push(`c.status = $${params.length}`) }
    if (query.priority) { params.push(query.priority); clauses.push(`c.priority = $${params.length}`) }
    if (query.category) { params.push(query.category); clauses.push(`c.category = $${params.length}`) }
    params.push(query.limit, query.offset)
    const result = await database.query(
      `${challengeSelect} ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
       order by c.created_at desc limit $${params.length - 1} offset $${params.length}`,
      params,
    )
    return { items: result.rows.map(shapeChallenge), limit: query.limit, offset: query.offset }
  })

  app.get('/challenges/:id', { preHandler: optionalAuth(database) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const result = await database.query(`${challengeSelect} where c.id = $1`, [params.id])
    const challenge = result.rows[0]
    if (!challenge) return notFound(reply, 'Challenge')
    if (!await canViewChallenge(database, params.id, request.authUser)) return notFound(reply, 'Challenge')
    const history = await database.query(
      `select h.from_status as "fromStatus", h.to_status as "toStatus", h.reason,
              h.created_at as "createdAt", p.name as "changedBy"
         from challenge_status_history h join profiles p on p.id = h.changed_by
        where h.challenge_id = $1 order by h.created_at desc`,
      [params.id],
    )
    return { ...shapeChallenge(challenge), statusHistory: history.rows }
  })

  app.post('/challenges', { preHandler: requireAuth(database) }, async (request, reply) => {
    const body = parse(createSchema, request.body, reply)
    if (!body) return
    const id = randomUUID()
    const created = await database.transaction(async (transaction) => {
      const result = await transaction.query(
        `insert into challenges(id, title, description, category, location, priority, owner_id)
         values($1, $2, $3, $4, $5, $6, $7)
         returning id, title, description, category, location, status, priority, readiness,
                   owner_id as "ownerId", created_at as "createdAt", updated_at as "updatedAt"`,
        [id, body.title, body.description, body.category, body.location, body.priority, request.authUser!.id],
      )
      await transaction.query(
        `insert into challenge_status_history(id, challenge_id, from_status, to_status, reason, changed_by)
         values($1, $2, null, 'Under review', 'Challenge submitted', $3)`,
        [randomUUID(), id, request.authUser!.id],
      )
      await notifyRole(transaction, 'Admin', 'Challenge awaiting review', body.title, 'challenge', id)
      return result.rows[0]!
    })
    return reply.code(201).send(shapeChallenge({ ...created, teams: 0, evidence: 0 }))
  })

  app.patch('/challenges/:id', { preHandler: requireAuth(database) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    const body = parse(updateSchema, request.body, reply)
    if (!params || !body) return
    const current = await database.query<{ owner_id: string; status: string }>('select owner_id, status from challenges where id = $1', [params.id])
    const challenge = current.rows[0]
    if (!challenge) return notFound(reply, 'Challenge')
    if (request.authUser!.role !== 'Admin' && challenge.owner_id !== request.authUser!.id) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only the challenge owner or an administrator can edit it.' })
    }
    if (request.authUser!.role !== 'Admin' && !['Under review', 'Denied'].includes(challenge.status)) {
      return conflict(reply, 'A challenge can only be edited by its owner while it is under review or denied.')
    }
    const fields = Object.entries(body)
    const values = fields.map(([, value]) => value)
    const set = fields.map(([key], index) => `${key === 'priority' ? key : key} = $${index + 1}`).join(', ')
    values.push(params.id)
    const result = await database.query(
      `update challenges set ${set}, updated_at = now() where id = $${values.length}
       returning id, title, description, category, location, status, priority, readiness,
                 owner_id as "ownerId", created_at as "createdAt", updated_at as "updatedAt"`,
      values,
    )
    return shapeChallenge(result.rows[0]!)
  })

  app.patch('/challenges/:id/status', { preHandler: requireAuth(database, ['Admin']) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    const body = parse(statusSchema, request.body, reply)
    if (!params || !body) return
    const outcome = await database.transaction(async (transaction) => {
      const current = await transaction.query<{ status: string; owner_id: string; title: string }>(
        'select status, owner_id, title from challenges where id = $1 for update',
        [params.id],
      )
      const challenge = current.rows[0]
      if (!challenge) return { kind: 'missing' as const }
      if (!transitions[challenge.status]?.includes(body.status)) {
        return { kind: 'invalid' as const, fromStatus: challenge.status }
      }
      const updated = await transaction.query(
        'update challenges set status = $1, updated_at = now() where id = $2 and status = $3',
        [body.status, params.id, challenge.status],
      )
      if (updated.affectedRows !== 1) return { kind: 'invalid' as const, fromStatus: challenge.status }
      await transaction.query(
        `insert into challenge_status_history(id, challenge_id, from_status, to_status, reason, changed_by)
         values($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), params.id, challenge.status, body.status, body.reason ?? null, request.authUser!.id],
      )
      const notificationTitle = body.status === 'Open'
        ? 'Challenge approved'
        : body.status === 'Denied'
          ? 'Challenge rejected'
          : 'Challenge status updated'
      await notify(transaction, challenge.owner_id, notificationTitle, `${challenge.title} is now ${body.status}.`, 'challenge', params.id)
      return { kind: 'updated' as const }
    })
    if (outcome.kind === 'missing') return notFound(reply, 'Challenge')
    if (outcome.kind === 'invalid') return conflict(reply, `Challenge status cannot move from ${outcome.fromStatus} to ${body.status}.`)
    return { id: params.id, status: body.status }
  })

  app.get('/challenges/:id/evidence', { preHandler: optionalAuth(database) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    if (!await canViewChallenge(database, params.id, request.authUser)) return notFound(reply, 'Challenge')
    const result = await database.query(
      `select e.id, e.original_name as "originalName", e.mime_type as "mimeType", e.size_bytes as "sizeBytes",
              e.caption, e.created_at as "createdAt", p.name as "uploadedBy"
         from challenge_evidence e join profiles p on p.id = e.uploaded_by
        where e.challenge_id = $1 order by e.created_at desc`,
      [params.id],
    )
    return { items: result.rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes) })) }
  })

  app.post('/challenges/:id/evidence', { preHandler: requireAuth(database) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const exists = await database.query('select 1 from challenges where id = $1', [params.id])
    if (!exists.rows.length) return notFound(reply, 'Challenge')
    if (!(await canContributeEvidence(database, params.id, request.authUser!))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only the challenge owner, a participating team member, or an administrator can add evidence.' })
    }
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'file_required', message: 'Attach one evidence file using the multipart file field.' })
    }
    const file = await request.file()
    if (!file) return reply.code(400).send({ error: 'file_required', message: 'Attach one evidence file using the file field.' })
    const allowed = new Map([
      ['image/jpeg', new Set(['.jpg', '.jpeg'])],
      ['image/png', new Set(['.png'])],
      ['image/webp', new Set(['.webp'])],
      ['video/mp4', new Set(['.mp4'])],
      ['application/pdf', new Set(['.pdf'])],
    ])
    const extension = extname(file.filename).toLowerCase()
    if (!allowed.get(file.mimetype)?.has(extension)) {
      return reply.code(415).send({ error: 'unsupported_media_type', message: 'Evidence must be a JPEG, PNG, WebP, MP4, or PDF file with a matching extension.' })
    }
    let buffer: Buffer
    try {
      buffer = await file.toBuffer()
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file_too_large', message: 'The evidence file exceeds the configured size limit.' })
      }
      throw error
    }
    if (buffer.length > config.maxUploadBytes) return reply.code(413).send({ error: 'file_too_large', message: 'The evidence file exceeds the configured size limit.' })
    if (!buffer.length) return reply.code(400).send({ error: 'empty_file', message: 'The evidence file is empty.' })
    if (!contentMatchesMime(file.mimetype, buffer)) {
      return reply.code(415).send({ error: 'invalid_file_content', message: 'The file contents do not match the declared evidence type.' })
    }
    await mkdir(config.uploadDir, { recursive: true })
    const storageKey = `${randomUUID()}${extension}`
    const storagePath = resolve(config.uploadDir, storageKey)
    await writeFile(storagePath, buffer, { flag: 'wx' })
    const captionField = (file.fields as Record<string, { value?: unknown }>).caption?.value
    const caption = typeof captionField === 'string' ? captionField.slice(0, 500) : null
    const id = randomUUID()
    try {
      await database.query(
        `insert into challenge_evidence(id, challenge_id, uploaded_by, original_name, mime_type, size_bytes, storage_key, caption)
         values($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, params.id, request.authUser!.id, file.filename, file.mimetype, buffer.length, storageKey, caption],
      )
    } catch (error) {
      await unlink(storagePath).catch(() => undefined)
      throw error
    }
    return reply.code(201).send({ id, originalName: file.filename, mimeType: file.mimetype, sizeBytes: buffer.length, caption })
  })

  app.get('/evidence/:id/download', { preHandler: requireAuth(database) }, async (request, reply) => {
    const params = parse(uuidParams, request.params, reply)
    if (!params) return
    const result = await database.query<{ storage_key: string; original_name: string; mime_type: string; challenge_id: string }>(
      'select storage_key, original_name, mime_type, challenge_id from challenge_evidence where id = $1',
      [params.id],
    )
    const evidence = result.rows[0]
    if (!evidence) return notFound(reply, 'Evidence')
    if (!await canViewChallenge(database, evidence.challenge_id, request.authUser)) return notFound(reply, 'Evidence')
    const path = resolve(config.uploadDir, evidence.storage_key)
    if (!path.startsWith(`${resolve(config.uploadDir)}${process.platform === 'win32' ? '\\' : '/'}`)) {
      return reply.code(500).send({ error: 'storage_error', message: 'The evidence path is invalid.' })
    }
    const data = await readFile(path)
    reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(evidence.original_name)}`)
    return reply.type(evidence.mime_type).send(data)
  })
}
