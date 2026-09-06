import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadConfig, type AppConfig } from '../src/config.js'
import { createDatabase } from '../src/db/database.js'

const secret = 'test-only-secret-with-at-least-thirty-two-characters'
const defaultPassword = 'Valid@Test123'

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
    devSeedEnabled: false,
    uploadDir: resolve(tmpdir(), `solvesphere-test-uploads-${crypto.randomUUID()}`),
    maxUploadBytes: 1024 * 1024,
    ...overrides,
  }
}

interface Session {
  accessToken: string
  refreshToken: string
  user: { id: string; email: string; name: string; role: 'Citizen' | 'Student' | 'Mentor' | 'Admin' }
}

async function signup(
  app: FastifyInstance,
  email: string,
  role: 'Citizen' | 'Student' | 'Mentor' = 'Citizen',
  password = defaultPassword,
) {
  const response = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { name: `${role} Tester`, email, password, role },
  })
  assert.equal(response.statusCode, 201, response.body)
  const payload = response.json() as { developmentCode: string; delivery: string; verificationRequired: boolean }
  assert.equal(payload.delivery, 'development')
  assert.equal(payload.verificationRequired, true)
  assert.match(payload.developmentCode, /^\d{6}$/)
  return payload.developmentCode
}

async function verify(app: FastifyInstance, email: string, code: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email, code } })
  assert.equal(response.statusCode, 200, response.body)
  return response.json() as Session
}

async function register(
  app: FastifyInstance,
  email: string,
  role: 'Citizen' | 'Student' | 'Mentor' = 'Citizen',
  password = defaultPassword,
) {
  return verify(app, email, await signup(app, email, role, password))
}

async function login(app: FastifyInstance, email: string, password = defaultPassword) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  assert.equal(response.statusCode, 200, response.body)
  return response.json() as Session
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

test('credential signup, verification, login, session rotation, logout, and validation are secure', async () => {
  const config = testConfig()
  const database = await createDatabase(config)
  const app = await buildApp({ config, database })
  try {
    let code = await signup(app, 'Person@Test.Local')

    const unverified = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'person@test.local', password: defaultPassword } })
    assert.equal(unverified.statusCode, 403)
    assert.equal(unverified.json().error, 'email_not_verified')

    const invalidCode = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'person@test.local', code: '000000' } })
    assert.equal(invalidCode.statusCode, 401)

    const resent = await app.inject({ method: 'POST', url: '/api/auth/resend-verification', payload: { email: 'person@test.local' } })
    assert.equal(resent.statusCode, 202, resent.body)
    assert.equal(resent.json().delivery, 'development')
    assert.match(resent.json().developmentCode, /^\d{6}$/)
    code = resent.json().developmentCode

    const verified = await verify(app, 'person@test.local', code)
    assert.equal(verified.user.role, 'Citizen')
    assert.equal(verified.user.email, 'person@test.local')
    assert.equal('password' in verified, false)

    const reusedCode = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'person@test.local', code } })
    assert.equal(reusedCode.statusCode, 401)

    const stored = await database.query<{ password_hash: string }>('select password_hash from profiles where email = $1', ['person@test.local'])
    assert.notEqual(stored.rows[0]!.password_hash, defaultPassword)
    assert.match(stored.rows[0]!.password_hash, /^\$2[aby]\$/)

    const wrongPassword = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'person@test.local', password: 'Wrong@Password1' } })
    assert.equal(wrongPassword.statusCode, 401)
    assert.equal(wrongPassword.json().error, 'invalid_credentials')
    const overBcryptLimit = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'person@test.local', password: `A1@${'é'.repeat(35)}` },
    })
    assert.equal(overBcryptLimit.statusCode, 400)

    const signedIn = await login(app, 'PERSON@test.local')
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(signedIn.accessToken) })
    assert.equal(me.statusCode, 200, me.body)
    assert.equal(me.json().user.role, 'Citizen')
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode, 401)

    const duplicate = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { name: 'Duplicate', email: 'PERSON@TEST.LOCAL', password: defaultPassword, role: 'Student' },
    })
    assert.equal(duplicate.statusCode, 409)
    assert.equal(duplicate.json().error, 'email_exists')

    const adminSignup = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { name: 'Not Admin', email: 'not-admin@test.local', password: defaultPassword, role: 'Admin' },
    })
    assert.equal(adminSignup.statusCode, 400)

    const weakPassword = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { name: 'Weak Password', email: 'weak@test.local', password: 'password', role: 'Citizen' },
    })
    assert.equal(weakPassword.statusCode, 400)

    const legacyId = crypto.randomUUID()
    await database.query(
      `insert into profiles(id, email, name, role, email_verified_at)
       values($1, 'legacy@test.local', 'Legacy Student', 'Student', now())`,
      [legacyId],
    )
    const legacyCode = await signup(app, 'legacy@test.local', 'Citizen', 'Legacy@Test123')
    const legacyBeforeVerification = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: 'legacy@test.local', password: 'Legacy@Test123' },
    })
    assert.equal(legacyBeforeVerification.statusCode, 403)
    const upgradedLegacy = await verify(app, 'legacy@test.local', legacyCode)
    assert.equal(upgradedLegacy.user.id, legacyId)
    assert.equal(upgradedLegacy.user.role, 'Student', 'legacy server role must be preserved during credential enrollment')
    await login(app, 'legacy@test.local', 'Legacy@Test123')

    const legacyAdminId = crypto.randomUUID()
    await database.query(
      `insert into profiles(id, email, name, role, email_verified_at)
       values($1, 'legacy-admin@test.local', 'Legacy Admin', 'Admin', now())`,
      [legacyAdminId],
    )
    const legacyAccessToken = app.jwt.sign({ email: 'legacy-admin@test.local' }, { sub: legacyAdminId })
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(legacyAccessToken) })).statusCode, 401)
    const legacyRefreshToken = 'legacy-refresh-token-that-is-long-enough-for-validation-1234567890'
    await database.query(
      `insert into refresh_tokens(id, user_id, token_hash, expires_at)
       values($1, $2, $3, now() + interval '1 day')`,
      [crypto.randomUUID(), legacyAdminId, createHash('sha256').update(legacyRefreshToken).digest('hex')],
    )
    assert.equal((await app.inject({
      method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: legacyRefreshToken },
    })).statusCode, 401)
    const adminEnrollment = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { name: 'Public Claim', email: 'legacy-admin@test.local', password: 'Claim@Test123', role: 'Citizen' },
    })
    assert.equal(adminEnrollment.statusCode, 409)
    assert.equal(adminEnrollment.json().error, 'email_exists')

    const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: signedIn.refreshToken } })
    assert.equal(refreshed.statusCode, 200, refreshed.body)
    assert.notEqual(refreshed.json().refreshToken, signedIn.refreshToken)
    assert.equal('token_id' in refreshed.json().user, false)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: signedIn.refreshToken } })).statusCode, 401)

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken: refreshed.json().refreshToken } })
    assert.equal(logout.statusCode, 204)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: refreshed.json().refreshToken } })).statusCode, 401)

    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email: 'person@test.local' } })).statusCode, 410)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email: 'person@test.local', code: '123456' } })).statusCode, 410)
  } finally {
    await app.close()
    await database.close()
    await rm(config.uploadDir, { recursive: true, force: true })
  }
})

test('development seeds are safe and idempotent', async () => {
  const config = testConfig({
    devSeedEnabled: true,
    devAdminEmail: 'admin@solvesphere.local',
    devAdminPassword: 'Admin@123',
  })
  const database = await createDatabase(config)
  const first = await buildApp({ config, database })
  await first.close()
  const app = await buildApp({ config, database })
  try {
    const admin = await login(app, 'admin@solvesphere.local', 'Admin@123')
    assert.equal(admin.user.role, 'Admin')
    const challenges = await app.inject({ method: 'GET', url: '/api/challenges' })
    assert.equal(challenges.statusCode, 200, challenges.body)
    assert.equal(challenges.json().items.length, 6)
    const overview = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(admin.accessToken) })
    assert.equal(overview.statusCode, 200, overview.body)
    assert.equal(overview.json().totalChallenges, 6)
    assert.equal(overview.json().totalUsers, 1)
  } finally {
    await app.close()
    await database.close()
    await rm(config.uploadDir, { recursive: true, force: true })
  }
})

test('complete citizen, admin, student, mentor, upload, notification, and admin-inspection workflow', async () => {
  const config = testConfig({
    devSeedEnabled: true,
    devAdminEmail: 'admin@solvesphere.local',
    devAdminPassword: 'Admin@123',
  })
  const app = await buildApp({ config })
  try {
    const admin = await login(app, 'admin@solvesphere.local', 'Admin@123')
    const citizen = await register(app, 'citizen@test.local', 'Citizen')
    const student = await register(app, 'student@test.local', 'Student')
    const teammate = await register(app, 'teammate@test.local', 'Student')
    const outsider = await register(app, 'outsider@test.local', 'Student')
    const mentor = await register(app, 'mentor@test.local', 'Mentor')

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
    assert.equal(createChallenge.json().status, 'Under review')

    const publicChallenges = await app.inject({ method: 'GET', url: '/api/challenges' })
    assert.equal(publicChallenges.json().items.some((item: { id: string }) => item.id === challengeId), false)
    assert.equal((await app.inject({ method: 'GET', url: '/api/challenges?mine=true' })).statusCode, 401)
    const myChallenges = await app.inject({ method: 'GET', url: '/api/challenges?mine=true', headers: auth(citizen.accessToken) })
    assert.ok(myChallenges.json().items.some((item: { id: string }) => item.id === challengeId))
    assert.equal((await app.inject({ method: 'GET', url: `/api/challenges/${challengeId}` })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/challenges/${challengeId}`, headers: auth(citizen.accessToken) })).statusCode, 200)
    assert.equal((await app.inject({ method: 'GET', url: `/api/challenges/${challengeId}`, headers: auth(mentor.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'POST', url: `/api/challenges/${challengeId}/teams`, headers: auth(student.accessToken), payload: { name: 'SafeCross' } })).statusCode, 409)
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(citizen.accessToken) })).statusCode, 403)

    const privateBoundary = 'private-evidence-boundary'
    const privateMultipart = Buffer.from(
      `--${privateBoundary}\r\nContent-Disposition: form-data; name="file"; filename="private.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 private test evidence\r\n--${privateBoundary}--\r\n`,
    )
    const privateEvidence = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/evidence`,
      headers: { ...auth(citizen.accessToken), 'content-type': `multipart/form-data; boundary=${privateBoundary}` }, payload: privateMultipart,
    })
    assert.equal(privateEvidence.statusCode, 201, privateEvidence.body)
    assert.equal((await app.inject({
      method: 'GET', url: `/api/evidence/${privateEvidence.json().id}/download`, headers: auth(mentor.accessToken),
    })).statusCode, 404)
    assert.equal((await app.inject({
      method: 'GET', url: `/api/evidence/${privateEvidence.json().id}/download`, headers: auth(citizen.accessToken),
    })).statusCode, 200)

    const adminPending = await app.inject({ method: 'GET', url: '/api/admin/challenges', headers: auth(admin.accessToken) })
    assert.ok(adminPending.json().items.some((item: { id: string; status: string }) => item.id === challengeId && item.status === 'Under review'))
    const opened = await app.inject({
      method: 'PATCH', url: `/api/challenges/${challengeId}/status`, headers: auth(admin.accessToken),
      payload: { status: 'Open', reason: 'Problem details are clear enough for publication.' },
    })
    assert.equal(opened.statusCode, 200, opened.body)

    const citizenNotifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(citizen.accessToken) })
    assert.ok(citizenNotifications.json().items.some((item: { title: string }) => item.title === 'Challenge approved'))

    const team = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/teams`, headers: auth(student.accessToken), payload: { name: 'SafeCross' },
    })
    assert.equal(team.statusCode, 201, team.body)
    const teamId = team.json().id as string
    const joined = await app.inject({ method: 'POST', url: `/api/teams/${teamId}/join`, headers: auth(teammate.accessToken) })
    assert.equal(joined.statusCode, 201, joined.body)
    const ownerNotifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(student.accessToken) })
    assert.ok(ownerNotifications.json().items.some((item: { title: string }) => item.title === 'New team member'))

    const missingFile = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/evidence`, headers: auth(student.accessToken), payload: {},
    })
    assert.equal(missingFile.statusCode, 400, missingFile.body)

    const invalidBoundary = 'invalid-evidence-boundary'
    const invalidMultipart = Buffer.from(
      `--${invalidBoundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nplain text\r\n--${invalidBoundary}--\r\n`,
    )
    const invalidEvidence = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/evidence`,
      headers: { ...auth(student.accessToken), 'content-type': `multipart/form-data; boundary=${invalidBoundary}` }, payload: invalidMultipart,
    })
    assert.equal(invalidEvidence.statusCode, 415, invalidEvidence.body)

    const spoofedBoundary = 'spoofed-evidence-boundary'
    const spoofedMultipart = Buffer.from(
      `--${spoofedBoundary}\r\nContent-Disposition: form-data; name="file"; filename="fake.pdf"\r\nContent-Type: application/pdf\r\n\r\nThis is not a PDF\r\n--${spoofedBoundary}--\r\n`,
    )
    const spoofedEvidence = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/evidence`,
      headers: { ...auth(student.accessToken), 'content-type': `multipart/form-data; boundary=${spoofedBoundary}` }, payload: spoofedMultipart,
    })
    assert.equal(spoofedEvidence.statusCode, 415, spoofedEvidence.body)
    assert.equal(spoofedEvidence.json().error, 'invalid_file_content')

    const boundary = 'valid-evidence-boundary'
    const multipart = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nSite survey\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="survey.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 test evidence\r\n--${boundary}--\r\n`,
    )
    const evidence = await app.inject({
      method: 'POST', url: `/api/challenges/${challengeId}/evidence`,
      headers: { ...auth(student.accessToken), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: multipart,
    })
    assert.equal(evidence.statusCode, 201, evidence.body)

    const invalidSolutionUrl = await app.inject({
      method: 'POST', url: `/api/teams/${teamId}/solutions`, headers: auth(student.accessToken),
      payload: {
        title: 'Invalid repository URL prototype',
        description: 'This otherwise valid draft must reject a repository URL using a non-web protocol.',
        repositoryUrl: 'ftp://example.test/repository',
      },
    })
    assert.equal(invalidSolutionUrl.statusCode, 400)

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
    assert.equal((await app.inject({ method: 'GET', url: `/api/solutions/${solutionId}`, headers: auth(mentor.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/solutions/${solutionId}`, headers: auth(citizen.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/solutions/${solutionId}`, headers: auth(outsider.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/solutions/${solutionId}/progress`, headers: auth(outsider.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/solutions/${solutionId}`, headers: auth(teammate.accessToken) })).statusCode, 200)
    const submitted = await app.inject({ method: 'POST', url: `/api/solutions/${solutionId}/submit`, headers: auth(student.accessToken) })
    assert.equal(submitted.statusCode, 200, submitted.body)
    assert.equal((await app.inject({ method: 'GET', url: `/api/solutions/${solutionId}`, headers: auth(mentor.accessToken) })).statusCode, 200)

    const mentorNotifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(mentor.accessToken) })
    assert.ok(mentorNotifications.json().items.some((item: { title: string }) => item.title === 'Solution ready for review'))
    const adminNotifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(admin.accessToken) })
    assert.ok(adminNotifications.json().items.some((item: { title: string }) => item.title === 'Solution submitted'))

    const citizenReview = await app.inject({
      method: 'PATCH', url: `/api/solutions/${solutionId}/review`, headers: auth(citizen.accessToken),
      payload: { decision: 'Approved', feedback: 'This review must be forbidden by the backend.' },
    })
    assert.equal(citizenReview.statusCode, 403)
    const feedback = 'The prototype has a clear pilot plan and measurable safety indicators.'
    const reviewed = await app.inject({
      method: 'PATCH', url: `/api/solutions/${solutionId}/review`, headers: auth(mentor.accessToken),
      payload: { decision: 'Approved', feedback },
    })
    assert.equal(reviewed.statusCode, 200, reviewed.body)
    const duplicateReview = await app.inject({
      method: 'PATCH', url: `/api/solutions/${solutionId}/review`, headers: auth(mentor.accessToken),
      payload: { decision: 'Changes requested', feedback: 'A second review must not create contradictory state.' },
    })
    assert.equal(duplicateReview.statusCode, 409)

    const teamNotifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(teammate.accessToken) })
    const reviewNotice = teamNotifications.json().items.find((item: { title: string }) => item.title === 'Solution review completed')
    assert.ok(reviewNotice)
    assert.match(reviewNotice.body, /clear pilot plan/)

    const progress = await app.inject({
      method: 'POST', url: `/api/solutions/${solutionId}/progress`, headers: auth(student.accessToken),
      payload: { summary: 'Completed the sensor prototype and prepared a supervised field test.', completionPercent: 65 },
    })
    assert.equal(progress.statusCode, 201, progress.body)

    const profile = await app.inject({
      method: 'PATCH', url: '/api/profiles/me', headers: auth(student.accessToken), payload: { name: 'Student Builder' },
    })
    assert.equal(profile.statusCode, 200, profile.body)
    assert.equal(profile.json().name, 'Student Builder')

    const deniedChallenge = await app.inject({
      method: 'POST', url: '/api/challenges', headers: auth(citizen.accessToken),
      payload: {
        title: 'Unsafe temporary road closure without signs',
        description: 'A temporary road closure has no warning signs and sends vehicles into a narrow residential lane.',
        category: 'Roads & Infrastructure', location: 'Pune, Maharashtra', priority: 'High',
      },
    })
    const deniedChallengeId = deniedChallenge.json().id as string
    await app.inject({
      method: 'PATCH', url: `/api/challenges/${deniedChallengeId}/status`, headers: auth(admin.accessToken),
      payload: { status: 'Open', reason: 'Published for an authorization regression test.' },
    })
    const deniedTeam = await app.inject({
      method: 'POST', url: `/api/challenges/${deniedChallengeId}/teams`, headers: auth(outsider.accessToken),
      payload: { name: 'Closure Safety Team' },
    })
    assert.equal(deniedTeam.statusCode, 201, deniedTeam.body)
    const deniedTeamId = deniedTeam.json().id as string
    const deniedEvidenceBoundary = 'denied-evidence-boundary'
    const deniedEvidencePayload = Buffer.from(
      `--${deniedEvidenceBoundary}\r\nContent-Disposition: form-data; name="file"; filename="closure.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 closure evidence\r\n--${deniedEvidenceBoundary}--\r\n`,
    )
    const deniedEvidence = await app.inject({
      method: 'POST', url: `/api/challenges/${deniedChallengeId}/evidence`,
      headers: { ...auth(outsider.accessToken), 'content-type': `multipart/form-data; boundary=${deniedEvidenceBoundary}` },
      payload: deniedEvidencePayload,
    })
    assert.equal(deniedEvidence.statusCode, 201, deniedEvidence.body)
    const denied = await app.inject({
      method: 'PATCH', url: `/api/challenges/${deniedChallengeId}/status`, headers: auth(admin.accessToken),
      payload: { status: 'Denied', reason: 'Duplicate municipal issue report.' },
    })
    assert.equal(denied.statusCode, 200, denied.body)
    const hiddenTeams = await app.inject({
      method: 'GET', url: `/api/teams?challengeId=${deniedChallengeId}`, headers: auth(teammate.accessToken),
    })
    assert.equal(hiddenTeams.statusCode, 200, hiddenTeams.body)
    assert.equal(hiddenTeams.json().items.length, 0)
    assert.equal((await app.inject({ method: 'GET', url: `/api/teams/${deniedTeamId}`, headers: auth(teammate.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'POST', url: `/api/teams/${deniedTeamId}/join`, headers: auth(teammate.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/challenges/${deniedChallengeId}`, headers: auth(teammate.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/evidence/${deniedEvidence.json().id}/download`, headers: auth(teammate.accessToken) })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/teams/${deniedTeamId}`, headers: auth(outsider.accessToken) })).statusCode, 200)

    const notifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(student.accessToken) })
    const unreadId = notifications.json().items.find((item: { readAt: string | null }) => !item.readAt)?.id
    assert.ok(unreadId)
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/notifications/${unreadId}/read`, headers: auth(student.accessToken) })).statusCode, 200)
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/notifications/read-all', headers: auth(student.accessToken) })).statusCode, 200)

    for (const path of ['/api/admin/challenges', '/api/admin/teams', '/api/admin/solutions', '/api/admin/reviews', '/api/admin/overview']) {
      const response = await app.inject({ method: 'GET', url: path, headers: auth(admin.accessToken) })
      assert.equal(response.statusCode, 200, `${path}: ${response.body}`)
    }
    const reviews = await app.inject({ method: 'GET', url: '/api/admin/reviews', headers: auth(admin.accessToken) })
    assert.ok(reviews.json().items.some((item: { solutionId: string; feedback: string }) => item.solutionId === solutionId && item.feedback === feedback))
    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: auth(student.accessToken) })
    assert.equal(dashboard.statusCode, 200, dashboard.body)
    assert.equal(dashboard.json().teams.mine, 1)
    assert.equal(dashboard.json().solutions.mine, 1)
  } finally {
    await app.close()
    await rm(config.uploadDir, { recursive: true, force: true })
  }
})

test('PGlite credentials and challenges survive an application restart', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'solvesphere-persistence-'))
  const config = testConfig({ pgliteDataDir: resolve(root, 'database'), uploadDir: resolve(root, 'uploads') })
  let challengeId: string
  const first = await buildApp({ config })
  try {
    const citizen = await register(first, 'persistent@test.local')
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
    const citizen = await login(second, 'persistent@test.local')
    const loaded = await second.inject({ method: 'GET', url: `/api/challenges/${challengeId!}`, headers: auth(citizen.accessToken) })
    assert.equal(loaded.statusCode, 200, loaded.body)
    assert.equal(loaded.json().title, 'Recurring water leakage near the community center')
  } finally {
    await second.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('production rejects all development auth and seed modes and never returns a verification code', async () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'production', DATABASE_MODE: 'postgres', DATABASE_URL: 'postgres://example.invalid/db',
    JWT_ACCESS_SECRET: secret, DEV_AUTH_ENABLED: 'true', DEV_SEED_ENABLED: 'false',
    OTP_DELIVERY_WEBHOOK_URL: 'https://mailer.example.test/verification',
  }), /cannot be enabled in production/)
  assert.throws(() => loadConfig({
    NODE_ENV: 'production', DATABASE_MODE: 'postgres', DATABASE_URL: 'postgres://example.invalid/db',
    JWT_ACCESS_SECRET: secret, DEV_AUTH_ENABLED: 'false', DEV_SEED_ENABLED: 'true',
    DEV_ADMIN_EMAIL: 'admin@solvesphere.local', DEV_ADMIN_PASSWORD: 'Admin@123',
    OTP_DELIVERY_WEBHOOK_URL: 'https://mailer.example.test/verification',
  }), /cannot be enabled in production/)
  assert.throws(() => loadConfig({
    NODE_ENV: 'production', DATABASE_MODE: 'postgres', DATABASE_URL: 'postgres://example.invalid/db',
    JWT_ACCESS_SECRET: secret, DEV_AUTH_ENABLED: 'false', DEV_SEED_ENABLED: 'false',
    OTP_DELIVERY_WEBHOOK_URL: 'http://mailer.example.test/verification',
  }), /must use HTTPS/)

  const config = testConfig({
    nodeEnv: 'production', devAuthEnabled: false, devSeedEnabled: false,
    otpDeliveryWebhookUrl: 'https://mailer.example.test/verification',
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 202 })
  const app = await buildApp({ config })
  try {
    const signupResponse = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { name: 'Production User', email: 'production@test.local', password: defaultPassword, role: 'Citizen' },
    })
    assert.equal(signupResponse.statusCode, 201, signupResponse.body)
    assert.equal(signupResponse.json().delivery, 'email')
    assert.equal('developmentCode' in signupResponse.json(), false)
  } finally {
    globalThis.fetch = originalFetch
    await app.close()
    await rm(config.uploadDir, { recursive: true, force: true })
  }
})
