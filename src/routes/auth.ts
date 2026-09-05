import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../config.js'
import type { Database } from '../db/database.js'
import type { AuthUser } from '../lib/auth.js'
import { requireAuth } from '../lib/auth.js'
import { parse } from '../lib/http.js'

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const requestCodeSchema = z.object({ email: emailSchema })
const verifyCodeSchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
const refreshSchema = z.object({ refreshToken: z.string().min(40).max(256) })

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

async function issueSession(app: FastifyInstance, database: Database, config: AppConfig, user: AuthUser) {
  const accessToken = app.jwt.sign(
    { email: user.email },
    { sub: user.id, expiresIn: config.accessTokenTtl as never },
  )
  const refreshToken = randomBytes(48).toString('base64url')
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000)
  await database.query(
    `insert into refresh_tokens(id, user_id, token_hash, expires_at)
     values($1, $2, $3, $4)`,
    [randomUUID(), user.id, tokenHash(refreshToken), expiresAt],
  )
  return { accessToken, refreshToken, expiresAt: expiresAt.toISOString(), user }
}

async function deliverCode(config: AppConfig, email: string, code: string) {
  if (config.devAuthEnabled) return
  const response = await fetch(config.otpDeliveryWebhookUrl!, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.otpDeliveryApiKey ? { authorization: `Bearer ${config.otpDeliveryApiKey}` } : {}),
    },
    body: JSON.stringify({ email, code, purpose: 'solvesphere-sign-in' }),
  })
  if (!response.ok) throw new Error(`OTP delivery failed with status ${response.status}`)
}

export async function authRoutes(app: FastifyInstance, database: Database, config: AppConfig) {
  app.post('/auth/request-code', async (request, reply) => {
    const body = parse(requestCodeSchema, request.body, reply)
    if (!body) return
    const code = config.devAuthEnabled ? config.devOtpCode! : String(randomInt(100000, 1_000_000))
    await database.query(
      `insert into verification_codes(id, email, code_hash, expires_at)
       values($1, $2, $3, $4)`,
      [randomUUID(), body.email, await hash(code, 10), new Date(Date.now() + 10 * 60 * 1000)],
    )
    try {
      await deliverCode(config, body.email, code)
    } catch (error) {
      request.log.error({ err: error }, 'OTP delivery failed')
      return reply.code(502).send({ error: 'otp_delivery_failed', message: 'The verification code could not be delivered.' })
    }
    return reply.code(202).send({ ok: true, expiresInSeconds: 600, delivery: config.devAuthEnabled ? 'development' : 'email' })
  })

  app.post('/auth/verify-code', async (request, reply) => {
    const body = parse(verifyCodeSchema, request.body, reply)
    if (!body) return
    const codes = await database.query<{
      id: string
      code_hash: string
      attempts: number
    }>(
      `select id, code_hash, attempts
         from verification_codes
        where email = $1 and used_at is null and expires_at > now() and attempts < 5
        order by created_at desc limit 1`,
      [body.email],
    )
    const record = codes.rows[0]
    if (!record) return reply.code(401).send({ error: 'invalid_code', message: 'The verification code is invalid or expired.' })

    await database.query('update verification_codes set attempts = attempts + 1 where id = $1', [record.id])
    if (!(await compare(body.code, record.code_hash))) {
      return reply.code(401).send({ error: 'invalid_code', message: 'The verification code is invalid or expired.' })
    }
    await database.query('update verification_codes set used_at = now() where id = $1', [record.id])

    const role = config.bootstrapAdminEmail === body.email ? 'Admin' : 'Citizen'
    const defaultName = body.email.split('@')[0]!.replace(/[._-]+/g, ' ').trim() || 'SolveSphere User'
    const profile = await database.query<AuthUser>(
      `insert into profiles(id, email, name, role)
       values($1, $2, $3, $4)
       on conflict(email) do update set updated_at = now()
       returning id, email, name, role`,
      [randomUUID(), body.email, defaultName, role],
    )
    return reply.send(await issueSession(app, database, config, profile.rows[0]!))
  })

  app.post('/auth/refresh', async (request, reply) => {
    const body = parse(refreshSchema, request.body, reply)
    if (!body) return
    const result = await database.query<AuthUser & { token_id: string }>(
      `select p.id, p.email, p.name, p.role, rt.id as token_id
         from refresh_tokens rt join profiles p on p.id = rt.user_id
        where rt.token_hash = $1 and rt.revoked_at is null and rt.expires_at > now()`,
      [tokenHash(body.refreshToken)],
    )
    const user = result.rows[0]
    if (!user) return reply.code(401).send({ error: 'invalid_refresh_token', message: 'The refresh token is invalid or expired.' })
    await database.query('update refresh_tokens set revoked_at = now() where id = $1', [user.token_id])
    return reply.send(await issueSession(app, database, config, user))
  })

  app.post('/auth/logout', async (request, reply) => {
    const body = parse(refreshSchema, request.body, reply)
    if (!body) return
    await database.query(
      'update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where token_hash = $1',
      [tokenHash(body.refreshToken)],
    )
    return reply.code(204).send()
  })

  app.get('/auth/me', { preHandler: requireAuth(database) }, async (request) => ({ user: request.authUser }))
}
