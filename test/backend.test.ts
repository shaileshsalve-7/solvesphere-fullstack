import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadConfig, type AppConfig } from '../src/config.js'

const secret = 'test-only-secret-with-at-least-thirty-two-characters'

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 4000,
    corsOrigins: ['http://localhost:5173'],
    databaseMode: 'pglite',
    pgliteDataDir: 'memory://',
    jwtAccessSecret: secret,
    accessTokenTtl: '15m',
    refreshTokenDays: 7,
    devAuthEnabled: true,
    devOtpCode: '123456',
    bootstrapAdminEmail: 'admin@test.local',
    uploadDir: resolve(tmpdir(), `solvesphere-test-uploads-${crypto.randomUUID()}`),
    maxUploadBytes: 1024 * 1024,
    ...overrides,
  }
}

async function signIn(app: FastifyInstance, email: string) {
  const requested = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email } })
  assert.equal(requested.statusCode, 202, requested.body)
  assert.equal(requested.json().delivery, 'development')
  assert.equal(requested.body.includes('123456'), false, 'OTP must not be returned in the response')
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email, code: '123456' } })
  assert.equal(verified.statusCode, 200, verified.body)
  return verified.json() as { accessToken: string; refreshToken: string; user: { id: string; role: string } }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

test('CORS permits authenticated browser mutation methods', async () => {
  const config = testConfig()
  const app = await buildApp({ config })
  try {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/challenges/example/status',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    })
    assert.equal(preflight.statusCode, 204, preflight.body)
    assert.match(preflight.headers['access-control-allow-methods'] ?? '', /PATCH/)
    assert.match(preflight.headers['access-control-allow-headers'] ?? '', /authorization/i)
  } finally {
    await app.close()
    await rm(config.uploadDir, { recursive: true, force: true })
  }
})

test('authentication uses server roles and rotates refresh tokens', async () => {
  const config = testConfig()
  const app = await buildApp({ config })
  try {
    const citizen = await signIn(app, 'person@test.local')
    assert.equal(citizen.user.role, 'Citizen')

    const admin = await signIn(app, 'admin@test.local')
    assert.equal(admin.user.role, 'Admin')

    const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: citizen.refreshToken } })
    assert.equal(refreshed.statusCode, 200, refreshed.body)
    assert.notEqual(refreshed.json().refreshToken, citizen.refreshToken)

    const reused = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: citizen.refreshToken } })
    assert.equal(reused.statusCode, 401)
  } finally {
    await app.close()
    await rm(config.uploadDir, { recursive: true, force: true })
  }
})

test('complete moderated challenge, team, solution, review, progress, and notification workflow', async () => {
  const config = testConfig()
  const app = await buildApp({ config })
  try {
    const admin = await signIn(app, 'admin@test.local')
    const citizen = await signIn(app, 'citizen@test.local')
    const student = await signIn(app, 'student@test.local')
    const mentor = await signIn(app, 'mentor@test.local')

    const createChallenge = await app.inject({
      method: 'POST', url: '/api/challenges', headers: auth(citizen.accessToken),
      payload: {
        title: 'Unsafe pedestrian crossing near a public school',
        description: 'Students and parents face fast traffic without signals during arrival and departure hours.',
        category: 'Public Infrastructure', location: 'Pune, Maharashtra', priority: 'Critical',
      },
    })
    assert.equal(createChallenge.statusCode, 201, createChallenge.body)
    const challengeId = createChallenge.json().id as string
    assert.match(challengeId, /^[0-9a-f-]{36}$/)
    assert.equal(createChallenge.json().status, 'Under review')

    const forbiddenTeam = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/teams`, headers: auth(student.accessToken), payload: { name: 'SafeCross' },
    })
    assert.equal(forbiddenTeam.statusCode, 403, 'unpromoted accounts must remain citizens')

    for (const [userId, role] of [[student.user.id, 'Student'], [mentor.user.id, 'Mentor']] as const) {
      const promoted = await app.inject({
        method: 'PATCH', url: `/api/admin/users/${userId}/role`, headers: auth(admin.accessToken), payload: { role },
      })
      assert.equal(promoted.statusCode, 200, promoted.body)
    }

    const opened = await app.inject({
      method: 'PATCH', url: `/api/challenges/${challengeId}/status`, headers: auth(admin.accessToken),
      payload: { status: 'Open', reason: 'Problem evidence is sufficient for publication.' },
    })
    assert.equal(opened.statusCode, 200, opened.body)

    const team = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/teams`, headers: auth(student.accessToken), payload: { name: 'SafeCross' },
    })
    assert.equal(team.statusCode, 201, team.body)
    const teamId = team.json().id as string

    const solution = await app.inject({
      method: 'POST', url: `/api/teams/${teamId}/solutions`, headers: auth(student.accessToken),
      payload: {
        title: 'Adaptive crossing alert prototype',
        description: 'A low-cost camera and signal workflow that detects pedestrians and alerts approaching drivers.',
        repositoryUrl: 'https://github.com/example/safecross',
      },
    })
    assert.equal(solution.statusCode, 201, solution.body)
    const solutionId = solution.json().id as string

    const submitted = await app.inject({ method: 'POST', url: `/api/solutions/${solutionId}/submit`, headers: auth(student.accessToken) })
    assert.equal(submitted.statusCode, 200, submitted.body)
    assert.equal(submitted.json().status, 'Mentor review')

    const citizenReview = await app.inject({
      method: 'PATCH', url: `/api/solutions/${solutionId}/review`, headers: auth(citizen.accessToken),
      payload: { decision: 'Approved', feedback: 'This review should be rejected by role authorization.' },
    })
    assert.equal(citizenReview.statusCode, 403)

    const reviewed = await app.inject({
      method: 'PATCH', url: `/api/solutions/${solutionId}/review`, headers: auth(mentor.accessToken),
      payload: { decision: 'Approved', feedback: 'The prototype has a clear pilot plan and measurable safety indicators.' },
    })
    assert.equal(reviewed.statusCode, 200, reviewed.body)

    const progress = await app.inject({
      method: 'POST', url: `/api/solutions/${solutionId}/progress`, headers: auth(student.accessToken),
      payload: { summary: 'Completed the sensor prototype and prepared a supervised field test.', completionPercent: 65 },
    })
    assert.equal(progress.statusCode, 201, progress.body)

    const boundary = 'solvesphere-evidence-boundary'
    const multipart = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nSite survey\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="survey.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 test evidence\r\n--${boundary}--\r\n`,
    )
    const evidence = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/evidence`,
      headers: { ...auth(student.accessToken), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: multipart,
    })
    assert.equal(evidence.statusCode, 201, evidence.body)

    const details = await app.inject({ method: 'GET', url: `/api/challenges/${challengeId}` })
    assert.equal(details.statusCode, 200, details.body)
    assert.equal(details.json().status, 'In progress')
    assert.equal(details.json().readiness, 65)
    assert.equal(details.json().teams, 1)
    assert.equal(details.json().evidence, 1)

    const notifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(student.accessToken) })
    assert.equal(notifications.statusCode, 200, notifications.body)
    assert.ok(notifications.json().items.some((item: { title: string }) => item.title === 'Solution review completed'))

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: auth(student.accessToken) })
    assert.equal(dashboard.statusCode, 200, dashboard.body)
    assert.equal(dashboard.json().teams.mine, 1)
    assert.equal(dashboard.json().solutions.mine, 1)
  } finally {
    await app.close()
    await rm(config.uploadDir, { recursive: true, force: true })
  }
})

test('PGlite data survives an application restart', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'solvesphere-persistence-'))
  const config = testConfig({ pgliteDataDir: resolve(root, 'database'), uploadDir: resolve(root, 'uploads') })
  let challengeId: string
  const first = await buildApp({ config })
  try {
    const citizen = await signIn(first, 'persistent@test.local')
    const created = await first.inject({
      method: 'POST', url: '/api/challenges', headers: auth(citizen.accessToken),
      payload: {
        title: 'Recurring water leakage near the community center',
        description: 'A damaged public pipe loses water daily and makes the adjacent walking path unsafe.',
        category: 'Environment', location: 'Pune, Maharashtra', priority: 'High',
      },
    })
    assert.equal(created.statusCode, 201, created.body)
    challengeId = created.json().id
  } finally {
    await first.close()
  }

  const second = await buildApp({ config })
  try {
    const loaded = await second.inject({ method: 'GET', url: `/api/challenges/${challengeId!}` })
    assert.equal(loaded.statusCode, 200, loaded.body)
    assert.equal(loaded.json().title, 'Recurring water leakage near the community center')
  } finally {
    await second.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('production configuration rejects development OTP authentication', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'production', DATABASE_MODE: 'postgres', DATABASE_URL: 'postgres://example.invalid/db',
    JWT_ACCESS_SECRET: secret, DEV_AUTH_ENABLED: 'true', DEV_OTP_CODE: '123456',
  }), /cannot be enabled in production/)
})
