import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const adminEmail = process.env.E2E_ADMIN_EMAIL
  ?? process.env.DEV_ADMIN_EMAIL
  ?? process.env.E2E_EMAIL
  ?? 'admin@solvesphere.local'
const adminPassword = process.env.E2E_ADMIN_PASSWORD
  ?? process.env.DEV_ADMIN_PASSWORD
  ?? 'Admin@123'
const userPassword = process.env.E2E_USER_PASSWORD ?? 'SolveSphere@123'
const candidates = [
  process.env.BROWSER_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean)
const executablePath = candidates.find((path) => existsSync(path))
assert.ok(executablePath, 'Set BROWSER_EXECUTABLE to an installed Edge or Chromium browser.')

const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const citizen = {
  name: 'E2E Citizen ' + runId,
  updatedName: 'E2E Citizen Verified ' + runId,
  email: 'e2e.citizen.' + runId + '@example.com',
}
const student = {
  name: 'E2E Student ' + runId,
  email: 'e2e.student.' + runId + '@example.com',
}
const mentor = {
  name: 'E2E Mentor ' + runId,
  email: 'e2e.mentor.' + runId + '@example.com',
}
const challengeTitle = 'E2E Safe School Crossing ' + runId
const teamName = 'E2E Civic Builders ' + runId
const solutionTitle = 'E2E Smart Crossing Kit ' + runId
const reviewFeedback = 'Approved after validating the safety plan, rollout steps, and measurable impact.'
const progressSummary = 'Completed the field prototype and validated the alert workflow with student volunteers.'

const tempDirectory = await mkdtemp(join(tmpdir(), 'solvesphere-e2e-'))
const evidencePath = join(tempDirectory, 'crossing-observation.pdf')
await writeFile(
  evidencePath,
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'utf8',
)

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  dumpio: process.env.E2E_DUMPIO === 'true',
  args: [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
page.setDefaultTimeout(20_000)
browser.on('disconnected', () => console.error('[browser] disconnected during ' + currentStage))
page.on('close', () => console.error('[browser] page closed during ' + currentStage))
page.on('error', (error) => console.error('[browser] page crash during ' + currentStage + ': ' + error.message))

const apiCalls = []
const apiFailures = []
const expectedApiFailures = []
const pageErrors = []
let refreshRecoveryActive = false
let currentStage = 'browser startup'

function stage(label) {
  currentStage = label
  console.log('[stage] ' + label)
}

function responsePath(response) {
  try {
    return new URL(response.url()).pathname
  } catch {
    return response.url()
  }
}

page.on('response', (response) => {
  if (!response.url().includes('/api/')) return
  const call = {
    method: response.request().method(),
    path: responsePath(response),
    status: response.status(),
  }
  apiCalls.push(call)
  if (call.status < 400) return
  if (refreshRecoveryActive && call.method === 'GET' && call.path === '/api/auth/me' && call.status === 401) {
    expectedApiFailures.push(call)
    return
  }
  apiFailures.push(call)
})

page.on('requestfailed', (request) => {
  if (!request.url().includes('/api/')) return
  apiFailures.push({
    method: request.method(),
    path: new URL(request.url()).pathname,
    status: request.failure()?.errorText ?? 'request failed',
  })
})

page.on('pageerror', (error) => {
  pageErrors.push(error.message)
})

function appUrl(pathname) {
  return new URL(pathname, baseUrl).toString()
}

async function waitForPath(pathname) {
  await page.waitForFunction(
    (expectedPath) => window.location.pathname === expectedPath,
    { timeout: 20_000 },
    pathname,
  )
}

async function waitForText(text, selector = 'body') {
  await page.waitForFunction(
    (expectedText, rootSelector) => {
      const root = document.querySelector(rootSelector)
      return Boolean(root?.textContent?.includes(expectedText))
    },
    { timeout: 20_000 },
    text,
    selector,
  )
}

async function settle() {
  // Vite keeps a development WebSocket open, so a bounded render pause is more
  // deterministic than waiting for the browser's global network-idle signal.
  await new Promise((resolve) => setTimeout(resolve, 400))
}

async function goto(pathname) {
  await page.goto(appUrl(pathname), { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await waitForPath(pathname)
}

async function click(selector) {
  const element = await page.waitForSelector(selector, { visible: true })
  assert.ok(element, 'Element not found: ' + selector)
  await element.click()
}

async function clickLink(pathname) {
  await click('a[href="' + pathname + '"]')
  await waitForPath(pathname)
}

async function clickButton(text, rootSelector = 'body') {
  await page.waitForFunction(
    (expectedText, selector) => {
      const root = document.querySelector(selector)
      return [...(root?.querySelectorAll('button') ?? [])].some((button) => (
        button.textContent?.trim() === expectedText
        && !button.disabled
        && button.getClientRects().length > 0
      ))
    },
    { timeout: 20_000 },
    text,
    rootSelector,
  )
  await page.evaluate((expectedText, selector) => {
    const root = document.querySelector(selector)
    const button = [...(root?.querySelectorAll('button') ?? [])].find((candidate) => (
      candidate.textContent?.trim() === expectedText
      && !candidate.disabled
      && candidate.getClientRects().length > 0
    ))
    if (!(button instanceof HTMLButtonElement)) throw new Error('Button not found: ' + expectedText)
    button.click()
  }, text, rootSelector)
}

async function fill(selector, value) {
  await page.waitForSelector(selector, { visible: true })
  await page.focus(selector)
  await page.keyboard.down('Control')
  await page.keyboard.press('A')
  await page.keyboard.up('Control')
  await page.keyboard.type(value)
  await page.waitForFunction(
    (fieldSelector, expectedValue) => document.querySelector(fieldSelector)?.value === expectedValue,
    { timeout: 20_000 },
    selector,
    value,
  )
  // Give controlled React inputs one render frame before the next field update.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const renderedValue = await page.$eval(selector, (element) => element.value)
  assert.equal(renderedValue, value, 'Controlled field did not retain its value: ' + selector)
}

async function choose(selector, value) {
  await page.waitForSelector(selector, { visible: true })
  const selected = await page.select(selector, value)
  assert.ok(selected.includes(value), 'Could not select ' + value + ' in ' + selector)
}

async function findEntityId(attribute, title, rootSelector = 'body') {
  await page.waitForFunction(
    (dataAttribute, expectedTitle, selector) => {
      const root = document.querySelector(selector)
      return [...(root?.querySelectorAll('[' + dataAttribute + ']') ?? [])]
        .some((candidate) => candidate.textContent?.includes(expectedTitle))
    },
    { timeout: 20_000 },
    attribute,
    title,
    rootSelector,
  )
  const id = await page.evaluate((dataAttribute, expectedTitle, selector) => {
    const root = document.querySelector(selector)
    const entity = [...(root?.querySelectorAll('[' + dataAttribute + ']') ?? [])]
      .find((candidate) => candidate.textContent?.includes(expectedTitle))
    return entity?.getAttribute(dataAttribute) ?? null
  }, attribute, title, rootSelector)
  assert.ok(id, 'Could not resolve ' + attribute + ' for ' + title)
  return id
}

async function signup(role, account) {
  await goto('/signup')
  await page.waitForSelector('[data-testid="signup-form"]', { visible: true })
  await fill('[data-testid="signup-form"] input[name="name"]', account.name)
  await fill('[data-testid="signup-form"] input[name="email"]', account.email)
  await click('button[data-role="' + role + '"]')
  await fill('[data-testid="signup-form"] input[name="password"]', userPassword)
  await fill('[data-testid="signup-form"] input[name="confirmPassword"]', userPassword)

  await click('[data-testid="signup-submit"]')
  await page.waitForSelector('[data-testid="verification-form"]', { visible: true })
  await page.waitForSelector('.development-code code', { visible: true })
  const developmentCode = await page.$eval('.development-code code', (element) => element.textContent?.trim() ?? '')
  assert.match(developmentCode, /^\d{6}$/, 'The local backend must return a development verification code.')
  await fill('[data-testid="verification-form"] input[name="verificationCode"]', developmentCode)
  await page.waitForSelector('[data-testid="verification-submit"]:not([disabled])', { visible: true })

  await click('[data-testid="verification-submit"]')
  await waitForPath('/dashboard')
  await waitForText(account.name, '.topbar .user')
  await waitForText(role, '.topbar .user')
  await settle()
}

async function login(email, password, expectedRole) {
  await goto('/login')
  await fill('[data-testid="login-form"] input[name="email"]', email)
  await fill('[data-testid="login-form"] input[name="password"]', password)
  await click('[data-testid="login-submit"]')
  await waitForPath(expectedRole === 'Admin' ? '/admin' : '/dashboard')
  await waitForText(expectedRole, '.topbar .user')
  await settle()
}

async function logout() {
  await click('[data-testid="logout-button"]')
  await page.waitForFunction(() => (
    localStorage.getItem('ss_access_token') === null
    && localStorage.getItem('ss_refresh_token') === null
    && localStorage.getItem('ss_user') === null
  ), { timeout: 20_000 })
  // Clearing the user can unmount the protected layout before its click handler
  // performs the final navigation, so move to the public route deterministically.
  await goto('/')
  const storedSession = await page.evaluate(() => ({
    access: localStorage.getItem('ss_access_token'),
    refresh: localStorage.getItem('ss_refresh_token'),
    user: localStorage.getItem('ss_user'),
  }))
  assert.deepEqual(storedSession, { access: null, refresh: null, user: null })
}

function requireCall(method, pathMatcher, status, label) {
  const found = apiCalls.some((call) => (
    call.method === method
    && call.status === status
    && (typeof pathMatcher === 'string' ? call.path === pathMatcher : pathMatcher.test(call.path))
  ))
  assert.ok(found, 'Missing verified API call: ' + label)
}

try {
  stage('anonymous routing')
  await goto('/')
  await waitForText('Turn real-world problems into')
  await waitForText('Create account')

  await page.goto(appUrl('/dashboard'), { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await waitForPath('/login')
  await page.waitForSelector('[data-testid="login-form"]', { visible: true })
  await waitForText('Administrator?', '[data-testid="admin-login-hint"]')
  assert.equal(new URL(page.url()).pathname, '/login', 'A protected route must redirect an anonymous visitor.')

  stage('Citizen signup and verification')
  await signup('Citizen', citizen)
  await page.waitForSelector('[data-testid="report-challenge-action"]', { visible: true })

  stage('Citizen profile update')
  await clickLink('/profile')
  await page.waitForSelector('[data-testid="profile-form"]', { visible: true })
  await fill('[data-testid="profile-form"] input[name="name"]', citizen.updatedName)
  await click('[data-action="save-profile"]')
  await waitForText('Profile updated.')
  await waitForText(citizen.updatedName)

  stage('Citizen challenge report and evidence')
  await clickLink('/challenges')
  await waitForText('Challenges')
  await settle()
  console.log('[detail] challenge list ready')
  await clickButton('Report challenge')
  await page.waitForSelector('[data-testid="challenge-form"]', { visible: true })
  await page.waitForSelector('[data-testid="challenge-evidence-input"]', { visible: true })
  console.log('[detail] challenge form opened')
  await fill('[data-testid="challenge-form"] input[name="title"]', challengeTitle)
  await fill('[data-testid="challenge-form"] input[name="category"]', 'Public Infrastructure')
  await fill('[data-testid="challenge-form"] input[name="location"]', 'Pune, Maharashtra')
  await choose('[data-testid="challenge-form"] select[name="priority"]', 'Critical')
  await fill(
    '[data-testid="challenge-form"] textarea[name="description"]',
    'Students cross a fast road without a working signal during busy school arrival and departure times.',
  )
  const reportEvidenceInput = await page.$('[data-testid="challenge-evidence-input"]')
  assert.ok(reportEvidenceInput, 'Evidence file input was not rendered in the Citizen report form.')
  await reportEvidenceInput.uploadFile(evidencePath)
  await fill('[data-testid="challenge-form"] input[name="evidenceCaption"]', 'School-hour traffic observation from the reported location.')
  console.log('[detail] challenge form filled')
  await clickButton('Submit for review', '[data-testid="challenge-form"]')
  console.log('[detail] challenge submit clicked')
  await waitForText('Challenge and evidence submitted for administrator review.')
  await waitForText(challengeTitle)
  const challenge = { id: await findEntityId('data-challenge-id', challengeTitle) }
  await waitForText('Under review', '[data-challenge-id="' + challenge.id + '"]')

  await goto('/challenges/' + challenge.id)
  await waitForText(challengeTitle)
  await waitForText('crossing-observation.pdf')

  stage('Admin login and challenge approval')
  await logout()
  await login(adminEmail, adminPassword, 'Admin')
  await page.waitForSelector('[data-testid="admin-challenges"]', { visible: true })
  await waitForText(challengeTitle, '[data-testid="admin-challenges"]')
  const moderationRowId = await page.evaluate((title) => {
    const row = [...document.querySelectorAll('[data-testid="admin-challenges"] [data-challenge-id]')]
      .find((candidate) => candidate.textContent?.includes(title))
    return row?.getAttribute('data-challenge-id')
  }, challengeTitle)
  assert.equal(moderationRowId, challenge.id, 'The citizen report must be visible in the admin console.')

  await click('[data-challenge-id="' + challenge.id + '"] button[data-action="status-open"]')
  await waitForText('Challenge approved and published.')
  await page.waitForFunction((id) => {
    const row = document.querySelector('[data-challenge-id="' + id + '"]')
    return Boolean(row?.textContent?.includes('Open') && !row.querySelector('[data-action="status-open"]'))
  }, { timeout: 20_000 }, challenge.id)

  stage('Student signup, team, and solution submission')
  await logout()
  await signup('Student', student)

  await clickLink('/teams')
  await waitForText('Teams')
  await settle()
  await clickButton('Create team')
  await page.waitForSelector('[data-testid="team-form"]', { visible: true })
  await choose('[data-testid="team-form"] select[name="challengeId"]', challenge.id)
  await fill('[data-testid="team-form"] input[name="name"]', teamName)
  await click('[data-action="create-team"]')
  await waitForText('Team created.')
  await waitForText(teamName)
  const team = { id: await findEntityId('data-team-id', teamName) }
  await waitForText(challengeTitle, '[data-team-id="' + team.id + '"]')

  await clickLink('/solutions')
  await waitForText('Solutions')
  await settle()
  await clickButton('Create solution')
  await page.waitForSelector('[data-testid="solution-form"]', { visible: true })
  await choose('[data-testid="solution-form"] select[name="teamId"]', team.id)
  await fill('[data-testid="solution-form"] input[name="title"]', solutionTitle)
  await fill(
    '[data-testid="solution-form"] textarea[name="description"]',
    'A solar-powered warning beacon and reporting workflow that helps students cross safely during peak school hours.',
  )
  await fill('[data-testid="solution-form"] input[name="repositoryUrl"]', 'https://example.com/repos/' + runId)
  await fill('[data-testid="solution-form"] input[name="demoUrl"]', 'https://example.com/demos/' + runId)
  const solutionFormState = await page.$eval('[data-testid="solution-form"]', (form) => ({
    valid: form.checkValidity(),
    fields: [...form.elements].filter((element) => 'name' in element && element.name).map((element) => ({
      name: element.name,
      value: element.value,
      valid: element.validity.valid,
      message: element.validationMessage,
    })),
  }))
  assert.equal(solutionFormState.valid, true, 'Solution form is invalid: ' + JSON.stringify(solutionFormState.fields))
  await page.waitForSelector('[data-action="create-solution"]:not([disabled])', { visible: true })
  await clickButton('Create draft', '[data-testid="solution-form"]')
  await waitForText('Solution draft created.')
  await waitForText(solutionTitle)
  const solution = { id: await findEntityId('data-solution-id', solutionTitle) }
  await waitForText('Draft', '[data-solution-id="' + solution.id + '"]')

  await click('[data-solution-id="' + solution.id + '"] [data-action="submit-solution"]')
  await waitForText('Solution submitted for mentor review.')
  await waitForText('Mentor review', '[data-solution-id="' + solution.id + '"]')

  stage('Mentor signup and review')
  await logout()
  await signup('Mentor', mentor)

  await clickLink('/solutions')
  await waitForText(solutionTitle)
  await settle()
  await click('[data-solution-id="' + solution.id + '"] [data-action="open-review"]')
  await page.waitForSelector('[data-solution-id="' + solution.id + '"] [data-testid="review-form"]', { visible: true })
  await fill(
    '[data-solution-id="' + solution.id + '"] [data-testid="review-form"] textarea[name="feedback"]',
    reviewFeedback,
  )
  await click('[data-solution-id="' + solution.id + '"] [data-action="approve-solution"]')
  await waitForText('Review saved: Approved.')
  await page.waitForFunction((id) => !document.querySelector('[data-solution-id="' + id + '"]'), { timeout: 20_000 }, solution.id)

  stage('Student feedback, refresh, notification, and progress')
  await logout()
  await login(student.email, userPassword, 'Student')
  await clickLink('/solutions')
  await waitForText(solutionTitle)
  await waitForText('Approved', '[data-solution-id="' + solution.id + '"]')
  await waitForText(reviewFeedback, '[data-solution-id="' + solution.id + '"]')
  await settle()

  refreshRecoveryActive = true
  await page.evaluate(() => localStorage.removeItem('ss_access_token'))
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 })
  await waitForPath('/solutions')
  await waitForText(solutionTitle)
  await waitForText(reviewFeedback, '[data-solution-id="' + solution.id + '"]')
  await page.waitForFunction(() => Boolean(localStorage.getItem('ss_access_token')), { timeout: 20_000 })
  await waitForText(student.name, '.topbar .user')
  await waitForText('Student', '.topbar .user')
  await settle()
  refreshRecoveryActive = false
  assert.ok(expectedApiFailures.length >= 1, 'Removing the access token should exercise one recoverable /auth/me 401.')
  const restoredSession = await page.evaluate(() => ({
    accessToken: localStorage.getItem('ss_access_token'),
    user: JSON.parse(localStorage.getItem('ss_user') ?? 'null'),
  }))
  assert.ok(restoredSession.accessToken, 'Refresh recovery must restore an access token.')
  assert.equal(restoredSession.user?.email, student.email)

  await clickLink('/notifications')
  await waitForText('Notifications')
  await waitForText('Solution review completed')
  await waitForText(solutionTitle)
  await waitForText(reviewFeedback)
  const reviewNotificationId = await page.evaluate((title) => {
    const row = [...document.querySelectorAll('[data-notification-id]')].find((candidate) => (
      candidate.querySelector('b')?.textContent?.trim() === 'Solution review completed'
      && candidate.textContent?.includes(title)
    ))
    if (!row?.classList.contains('unread')) return null
    return row.getAttribute('data-notification-id')
  }, solutionTitle)
  assert.ok(reviewNotificationId, 'The student must receive an unread notification containing the mentor review.')
  await click('[data-notification-id="' + reviewNotificationId + '"] [data-action="read-notification"]')
  await page.waitForFunction((id) => {
    const row = document.querySelector('[data-notification-id="' + id + '"]')
    return Boolean(row && !row.classList.contains('unread') && !row.querySelector('[data-action="read-notification"]'))
  }, { timeout: 20_000 }, reviewNotificationId)

  await clickLink('/solutions')
  await waitForText(solutionTitle)
  await click('[data-solution-id="' + solution.id + '"] [data-action="open-progress"]')
  await page.waitForSelector('[data-solution-id="' + solution.id + '"] [data-testid="progress-form"]', { visible: true })
  await fill(
    '[data-solution-id="' + solution.id + '"] [data-testid="progress-form"] textarea[name="summary"]',
    progressSummary,
  )
  await fill(
    '[data-solution-id="' + solution.id + '"] [data-testid="progress-form"] textarea[name="blockers"]',
    'No blocking issue; local authority feedback is scheduled.',
  )
  await page.$eval(
    '[data-solution-id="' + solution.id + '"] [data-testid="progress-form"] input[name="completionPercent"]',
    (input, value) => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    72,
  )
  await waitForText('Completion: 72%', '[data-solution-id="' + solution.id + '"]')
  await click('[data-solution-id="' + solution.id + '"] [data-action="save-progress"]')
  await waitForText('Progress update saved.')
  await waitForText('Latest progress: 72%', '[data-solution-id="' + solution.id + '"]')
  await waitForText(progressSummary, '[data-solution-id="' + solution.id + '"]')
  await waitForText('Approved', '[data-solution-id="' + solution.id + '"]')

  stage('Admin inspection and challenge resolution')
  await logout()
  await login(adminEmail, adminPassword, 'Admin')
  await waitForText(teamName, '[data-testid="admin-teams"]')
  await waitForText(solutionTitle, '[data-testid="admin-solutions"]')
  await waitForText(reviewFeedback, '[data-testid="admin-reviews"]')
  await waitForText(challengeTitle, '[data-testid="admin-challenges"]')
  await click('[data-challenge-id="' + challenge.id + '"] button[data-action="status-resolved"]')
  await waitForText('Challenge moved to Resolved.')
  await page.waitForFunction((id) => {
    const row = document.querySelector('[data-challenge-id="' + id + '"]')
    const status = row?.querySelector('.admin-status-actions > .badge')?.textContent?.trim()
    return status === 'Resolved' && !row?.querySelector('[data-action="status-resolved"]')
  }, { timeout: 20_000 }, challenge.id)

  await logout()
  await page.goto(appUrl('/solutions'), { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await waitForPath('/login')
  await page.waitForSelector('[data-testid="login-form"]', { visible: true })

  assert.deepEqual(
    apiFailures,
    [],
    'Unexpected API failures:\n' + apiFailures.map((call) => call.method + ' ' + call.path + ' ' + call.status).join('\n'),
  )
  assert.deepEqual(pageErrors, [], 'Browser page errors:\n' + pageErrors.join('\n'))

  requireCall('POST', '/api/auth/signup', 201, 'three role signups')
  assert.equal(apiCalls.filter((call) => call.method === 'POST' && call.path === '/api/auth/signup' && call.status === 201).length, 3)
  assert.equal(apiCalls.filter((call) => call.method === 'POST' && call.path === '/api/auth/verify-email' && call.status === 200).length, 3)
  requireCall('POST', '/api/auth/login', 200, 'password login')
  requireCall('PATCH', '/api/profiles/me', 200, 'profile edit')
  requireCall('POST', '/api/challenges', 201, 'citizen challenge report')
  requireCall('POST', /\/api\/challenges\/[^/]+\/evidence$/, 201, 'evidence upload')
  requireCall('PATCH', /\/api\/challenges\/[^/]+\/status$/, 200, 'admin challenge approval')
  requireCall('POST', /\/api\/challenges\/[^/]+\/teams$/, 201, 'student team creation')
  requireCall('POST', /\/api\/teams\/[^/]+\/solutions$/, 201, 'solution draft')
  requireCall('POST', /\/api\/solutions\/[^/]+\/submit$/, 200, 'solution submission')
  requireCall('PATCH', /\/api\/solutions\/[^/]+\/review$/, 200, 'mentor review')
  requireCall('POST', /\/api\/solutions\/[^/]+\/progress$/, 201, 'progress update')
  requireCall('GET', '/api/notifications', 200, 'student notifications')
  requireCall('PATCH', /\/api\/notifications\/[^/]+\/read$/, 200, 'mark notification read')
  requireCall('POST', '/api/auth/refresh', 200, 'refresh-token recovery')
  requireCall('POST', '/api/auth/logout', 204, 'session logout')

  console.log('SolveSphere Edge lifecycle passed.')
  console.log('Run ID: ' + runId)
  console.log('Verified: public/protected routing, Citizen report + evidence, admin approval, Student team + solution + progress, Mentor review, notification read, profile edit, refresh recovery, and logout.')
  console.log('Successful API responses observed: ' + apiCalls.filter((call) => call.status < 400).length)
  console.log('Expected recoverable API responses observed: ' + expectedApiFailures.length)
} catch (error) {
  console.error('Failed stage: ' + currentStage)
  console.error('API responses before failure:')
  console.error(apiCalls.map((call) => call.method + ' ' + call.path + ' ' + call.status).join('\n'))
  console.error('Unexpected API failures before failure:')
  console.error(apiFailures.map((call) => call.method + ' ' + call.path + ' ' + call.status).join('\n'))
  console.error('Browser page errors before failure:')
  console.error(pageErrors.join('\n'))
  throw error
} finally {
  refreshRecoveryActive = false
  try {
    await browser.close()
  } catch (closeError) {
    console.error('Browser cleanup warning:', closeError instanceof Error ? closeError.message : closeError)
  }
  await rm(tempDirectory, { recursive: true, force: true })
}
