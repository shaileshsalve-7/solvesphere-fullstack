import { mkdir } from 'node:fs/promises'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from './config.js'
import { createDatabase, type Database } from './db/database.js'
import { migrate } from './db/migrate.js'
import { seedDevelopmentData } from './db/seed.js'
import { seedDemoData } from './db/demo-seed.js'
import { accountRoutes } from './routes/account.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { challengeRoutes } from './routes/challenges.js'
import { solutionRoutes } from './routes/solutions.js'
import { teamRoutes } from './routes/teams.js'

interface BuildOptions {
  config: AppConfig
  database?: Database
  logger?: boolean
  runMigrations?: boolean
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: options.config.maxUploadBytes + 1024 * 1024 })
  const ownsDatabase = !options.database
  const database = options.database ?? await createDatabase(options.config)
  if (options.runMigrations !== false) await migrate(database)
  if (options.runMigrations !== false) await seedDevelopmentData(database, options.config)
  if (options.runMigrations !== false) await seedDemoData(database, options.config)
  await mkdir(options.config.uploadDir, { recursive: true })

  app.decorateRequest('authUser', null)
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || options.config.corsOrigins.includes(origin)) return callback(null, true)
      return callback(new Error('Origin is not allowed'), false)
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
  await app.register(rateLimit, { max: options.config.nodeEnv === 'test' ? 10_000 : 200, timeWindow: '1 minute' })
  await app.register(jwt, { secret: options.config.jwtAccessSecret })
  await app.register(multipart, { limits: { files: 1, fileSize: options.config.maxUploadBytes, fields: 4 } })

  app.get('/health', async () => {
    await database.query('select 1 as ok')
    return { status: 'ok', database: options.config.databaseMode }
  })

  await app.register(async (api) => {
    await authRoutes(api, database, options.config)
    await challengeRoutes(api, database, options.config)
    await teamRoutes(api, database)
    await solutionRoutes(api, database)
    await accountRoutes(api, database)
    await adminRoutes(api, database)
  }, { prefix: '/api' })

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request failed')
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined
    const message = error instanceof Error ? error.message : 'The request could not be processed.'
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({ error: 'request_error', message })
    }
    return reply.code(500).send({ error: 'internal_error', message: 'The server could not complete the request.' })
  })

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found', message: 'The API route does not exist.' }))
  if (ownsDatabase) app.addHook('onClose', async () => database.close())
  return app
}
