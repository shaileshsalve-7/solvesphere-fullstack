import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../config.js'
import type { Database } from '../db/database.js'
import type { AuthUser } from '../lib/auth.js'
import { requireAuth } from '../lib/auth.js'
import { conflict, parse } from '../lib/http.js'

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const passwordSchema = z.string().min(8).max(128)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.')
  .refine((value) => /[a-z]/.test(value), 'Password must include a lowercase letter.')
  .refine((value) => /[A-Z]/.test(value), 'Password must include an uppercase letter.')
  .refine((value) => /\d/.test(value), 'Password must include a number.')
  .refine((value) => /[^A-Za-z0-9]/.test(value), 'Password must include a symbol.')
const loginPasswordSchema = z.string().min(1).max(128)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.')
const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['Citizen', 'Student', 'Mentor']),
})
const loginSchema = z.object({ email: emailSchema, password: loginPasswordSchema })
const requestCodeSchema = z.object({ email: emailSchema })
const verifyCodeSchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
const refreshSchema = z.object({ refreshToken: z.string().min(40).max(256) })
type VerificationPurpose = 'email-verification' | 'sign-in' | 'password-reset'
const resetPasswordSchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/), password: passwordSchema })

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; message?: string }
  return candidate?.code === '23505' || String(candidate?.message ?? error).toLowerCase().includes('unique')
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

async function deliverCode(config: AppConfig, email: string, code: string, purpose: VerificationPurpose) {
  if (config.devAuthEnabled) return
  if (config.brevoApiKey) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': config.brevoApiKey },
      body: JSON.stringify({
        sender: { name: 'SolveSphere', email: config.brevoSenderEmail },
        to: [{ email }],
        subject: purpose === 'password-reset' ? 'Reset your SolveSphere password' : 'Verify your SolveSphere email',
        textContent: `Your SolveSphere ${purpose === 'password-reset' ? 'password reset' : 'verification'} code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Brevo verification delivery failed with status ${response.status}`)
    return
  }
  if (config.resendApiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.resendApiKey}` },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [email],
        subject: purpose === 'password-reset' ? 'Reset your SolveSphere password' : 'Verify your SolveSphere email',
        html: `<p>Your SolveSphere ${purpose === 'password-reset' ? 'password reset' : 'verification'} code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Verification delivery failed with status ${response.status}`)
    return
  }
  const response = await fetch(config.otpDeliveryWebhookUrl!, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.otpDeliveryApiKey ? { authorization: `Bearer ${config.otpDeliveryApiKey}` } : {}),
    },
    body: JSON.stringify({ email, code, purpose }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Verification delivery failed with status ${response.status}`)
}

async function createVerification(
  database: Database,
  config: AppConfig,
  email: string,
  purpose: VerificationPurpose,
) {
  const code = String(randomInt(100000, 1_000_000))
  const id = randomUUID()
  const codeHash = await hash(code, config.nodeEnv === 'test' ? 4 : 10)
  await database.transaction(async (transaction) => {
    await transaction.query(
      `update verification_codes set used_at = coalesce(used_at, now())
        where email = $1 and purpose = $2 and used_at is null`,
      [email, purpose],
    )
    await transaction.query(
      `insert into verification_codes(id, email, code_hash, expires_at, purpose)
       values($1, $2, $3, $4, $5)`,
      [id, email, codeHash, new Date(Date.now() + 10 * 60 * 1000), purpose],
    )
  })
  try {
    await deliverCode(config, email, code, purpose)
  } catch (error) {
    await database.query('update verification_codes set used_at = now() where id = $1', [id])
    throw error
  }
  return {
    ok: true,
    email,
    verificationRequired: purpose === 'email-verification',
    delivery: config.devAuthEnabled ? 'development' : 'email',
    expiresInSeconds: 600,
    ...(config.devAuthEnabled && config.nodeEnv !== 'production' ? { developmentCode: code } : {}),
  }
}

async function consumeCode(database: Database, email: string, code: string, purpose: VerificationPurpose) {
  return database.transaction(async (transaction) => {
    const codes = await transaction.query<{ id: string; code_hash: string }>(
      `select id, code_hash
         from verification_codes
        where email = $1 and purpose = $2 and used_at is null and expires_at > now() and attempts < 5
        order by created_at desc limit 1 for update`,
      [email, purpose],
    )
    const record = codes.rows[0]
    if (!record) return false
    await transaction.query('update verification_codes set attempts = attempts + 1 where id = $1', [record.id])
    if (!(await compare(code, record.code_hash))) return false
    const consumed = await transaction.query(
      'update verification_codes set used_at = now() where id = $1 and used_at is null',
      [record.id],
    )
    return consumed.affectedRows === 1
  })
}

export async function authRoutes(app: FastifyInstance, database: Database, config: AppConfig) {
  app.post('/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const body = parse(signupSchema, request.body, reply)
    if (!body) return
    const existing = await database.query<{ id: string; role: string; password_hash: string | null }>(
      'select id, role, password_hash from profiles where email = $1',
      [body.email],
    )
    if (existing.rows[0]?.password_hash) return conflict(reply, 'An account with this email already exists.', 'email_exists')
    if (existing.rows[0]?.role === 'Admin') {
      return conflict(reply, 'An account with this email already exists.', 'email_exists')
    }
    const passwordHash = await hash(body.password, config.nodeEnv === 'test' ? 4 : 12)
    try {
      if (existing.rows[0]) {
        const upgraded = await database.transaction(async (transaction) => {
          const result = await transaction.query(
            `update profiles set name = $1, password_hash = $2, email_verified_at = null, updated_at = now()
              where id = $3 and password_hash is null`,
            [body.name, passwordHash, existing.rows[0]!.id],
          )
          if (result.affectedRows !== 1) return false
          await transaction.query('update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where user_id = $1', [existing.rows[0]!.id])
          return true
        })
        if (!upgraded) return conflict(reply, 'An account with this email already exists.', 'email_exists')
      } else {
        await database.query(
          `insert into profiles(id, email, name, role, password_hash)
           values($1, $2, $3, $4, $5)`,
          [randomUUID(), body.email, body.name, body.role, passwordHash],
        )
      }
    } catch (error) {
      if (isUniqueViolation(error)) return conflict(reply, 'An account with this email already exists.', 'email_exists')
      throw error
    }

    try {
      const verification = await createVerification(database, config, body.email, 'email-verification')
      return reply.code(201).send(verification)
    } catch (error) {
      request.log.error({ err: error }, 'Email verification delivery failed')
      return reply.code(502).send({ error: 'verification_delivery_failed', message: 'The verification email could not be delivered. You can retry from the verification screen.' })
    }
  })

  app.post('/auth/verify-email', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = parse(verifyCodeSchema, request.body, reply)
    if (!body) return
    if (!(await consumeCode(database, body.email, body.code, 'email-verification'))) {
      return reply.code(401).send({ error: 'invalid_code', message: 'The verification code is invalid or expired.' })
    }
    const profile = await database.query<AuthUser>(
      `update profiles set email_verified_at = coalesce(email_verified_at, now()),
         role = case when email = $2 then 'Admin' else role end, updated_at = now()
        where email = $1 and password_hash is not null
        returning id, email, name, role`,
      [body.email, config.bootstrapAdminEmail ?? ''],
    )
    const user = profile.rows[0]
    if (!user) return reply.code(404).send({ error: 'account_not_found', message: 'Create an account before verifying this email.' })
    return reply.send(await issueSession(app, database, config, user))
  })

  app.post('/auth/resend-verification', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = parse(requestCodeSchema, request.body, reply)
    if (!body) return
    const result = await database.query<{ email_verified_at: Date | null; password_hash: string | null }>(
      'select email_verified_at, password_hash from profiles where email = $1',
      [body.email],
    )
    const account = result.rows[0]
    if (!account?.password_hash) return reply.code(404).send({ error: 'account_not_found', message: 'Create an account before requesting verification.' })
    if (account.email_verified_at) return conflict(reply, 'This email is already verified.', 'email_already_verified')
    try {
      return reply.code(202).send(await createVerification(database, config, body.email, 'email-verification'))
    } catch (error) {
      request.log.error({ err: error }, 'Email verification delivery failed')
      return reply.code(502).send({ error: 'verification_delivery_failed', message: 'The verification email could not be delivered.' })
    }
  })

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = parse(loginSchema, request.body, reply)
    if (!body) return
    const result = await database.query<AuthUser & { password_hash: string | null; email_verified_at: Date | null }>(
      `select id, email, name, role, password_hash, email_verified_at
         from profiles where email = $1`,
      [body.email],
    )
    const account = result.rows[0]
    if (!account?.password_hash || !(await compare(body.password, account.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'The email or password is incorrect.' })
    }
    if (!account.email_verified_at) {
      return reply.code(403).send({ error: 'email_not_verified', message: 'Verify your email before signing in.' })
    }
    const user: AuthUser = { id: account.id, email: account.email, name: account.name, role: account.role }
    return reply.send(await issueSession(app, database, config, user))
  })

  app.post('/auth/request-password-reset', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = parse(requestCodeSchema, request.body, reply)
    if (!body) return
    const account = await database.query<{ password_hash: string | null }>('select password_hash from profiles where email = $1', [body.email])
    if (account.rows[0]?.password_hash) {
      try { await createVerification(database, config, body.email, 'password-reset') }
      catch (error) {
        request.log.error({ err: error }, 'Password reset delivery failed')
        return reply.code(502).send({ error: 'verification_delivery_failed', message: 'The reset email could not be delivered.' })
      }
    }
    return reply.code(202).send({ ok: true, email: body.email, delivery: 'email', expiresInSeconds: 600 })
  })

  app.post('/auth/reset-password', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = parse(resetPasswordSchema, request.body, reply)
    if (!body) return
    if (!(await consumeCode(database, body.email, body.code, 'password-reset'))) {
      return reply.code(401).send({ error: 'invalid_code', message: 'The reset code is invalid or expired.' })
    }
    const passwordHash = await hash(body.password, config.nodeEnv === 'test' ? 4 : 12)
    const profile = await database.transaction(async (transaction) => {
      const result = await transaction.query<AuthUser>(
        `update profiles set password_hash = $1, email_verified_at = coalesce(email_verified_at, now()),
           role = case when email = $3 then 'Admin' else role end, updated_at = now()
         where email = $2 and password_hash is not null returning id, email, name, role`,
        [passwordHash, body.email, config.bootstrapAdminEmail ?? ''],
      )
      const user = result.rows[0]
      if (user) await transaction.query('update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where user_id = $1', [user.id])
      return user
    })
    if (!profile) return reply.code(404).send({ error: 'account_not_found', message: 'No account exists for this email.' })
    return reply.send(await issueSession(app, database, config, profile))
  })

  app.post('/auth/request-code', async (_request, reply) => reply.code(410).send({
    error: 'passwordless_auth_retired',
    message: 'Passwordless sign-in has been retired. Use Create account or password login.',
  }))

  app.post('/auth/verify-code', async (_request, reply) => reply.code(410).send({
    error: 'passwordless_auth_retired',
    message: 'Passwordless sign-in has been retired. Use email verification or password login.',
  }))

  app.post('/auth/refresh', async (request, reply) => {
    const body = parse(refreshSchema, request.body, reply)
    if (!body) return
    const session = await database.transaction(async (transaction) => {
      const result = await transaction.query<AuthUser & { token_id: string }>(
        `select p.id, p.email, p.name, p.role, rt.id as token_id
           from refresh_tokens rt join profiles p on p.id = rt.user_id
          where rt.token_hash = $1 and rt.revoked_at is null and rt.expires_at > now()
            and p.email_verified_at is not null and p.password_hash is not null
          for update of rt`,
        [tokenHash(body.refreshToken)],
      )
      const user = result.rows[0]
      if (!user) return undefined
      const revoked = await transaction.query(
        'update refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null',
        [user.token_id],
      )
      if (revoked.affectedRows !== 1) return undefined
      const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role }
      return issueSession(app, transaction, config, authUser)
    })
    if (!session) return reply.code(401).send({ error: 'invalid_refresh_token', message: 'The refresh token is invalid or expired.' })
    return reply.send(session)
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
