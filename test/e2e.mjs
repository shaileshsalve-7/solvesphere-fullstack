import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const email = process.env.E2E_EMAIL ?? 'admin@solvesphere.local'
const code = process.env.E2E_CODE ?? '123456'
const candidates = [
  process.env.BROWSER_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)
const executablePath = candidates.find((path) => existsSync(path))
assert.ok(executablePath, 'Set BROWSER_EXECUTABLE to an installed Chromium browser')

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
const apiCalls = []
const apiFailures = []
page.on('response', (response) => {
  if (response.url().includes('/api/')) {
    apiCalls.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`)
    if (response.status() >= 400) apiFailures.push(`${response.request().method()} ${response.url()} ${response.status()}`)
  }
})
page.on('requestfailed', (request) => {
  if (request.url().includes('/api/')) apiFailures.push(`${request.method()} ${request.url()} failed`)
})

async function waitForText(text) {
  await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 15_000 }, text)
}

async function clickLink(href) {
  await page.locator(`a[href="${href}"]`).click()
  await page.waitForFunction((path) => window.location.pathname === path, { timeout: 10_000 }, href)
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 20_000 })
  await waitForText('Turn real-world problems into')
  await clickLink('/login')

  await page.locator('input[type="email"]').fill(email)
  await page.locator('button[type="submit"]').click()
  await page.locator('input[inputmode="numeric"]').fill(code)
  await page.locator('button[type="submit"]').click()
  await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 15_000 })
  await waitForText('Good to see you')
  await page.waitForSelector('a[href="/admin"]', { visible: true, timeout: 15_000 })

  await clickLink('/challenges')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Report challenge')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Report challenge button not found')
    button.click()
  })
  await page.waitForSelector('form.form-grid', { visible: true, timeout: 10_000 })
  const title = `Browser-verified crossing ${Date.now()}`
  const inputs = await page.$$('form.form-grid input')
  assert.equal(inputs.length >= 3, true, 'challenge form inputs are missing')
  await inputs[0].type(title)
  await inputs[1].type('Public Infrastructure')
  await inputs[2].type('Pune, Maharashtra')
  await page.locator('form.form-grid textarea').fill('Students cross a fast road without a working signal during busy school arrival and departure times.')
  await page.select('form.form-grid select', 'Critical')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('form.form-grid button')].find((item) => item.textContent?.trim() === 'Submit for review')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Submit for review button not found')
    button.click()
  })
  await waitForText('Challenge submitted for administrator review.')

  await clickLink('/admin')
  await waitForText(title)
  const moderationResponse = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && /\/api\/challenges\/[^/]+\/status$/.test(response.url()),
    { timeout: 10_000 },
  )
  const challengeId = await page.evaluate((expectedTitle) => {
    const row = [...document.querySelectorAll('.admin-row')].find((item) => item.textContent?.includes(expectedTitle))
    if (!(row instanceof HTMLElement) || !row.dataset.challengeId) throw new Error('Challenge moderation row not found')
    return row.dataset.challengeId
  }, title)
  await page.click(`[data-challenge-id="${challengeId}"] button[data-action="publish"]`)
  const response = await moderationResponse
  const responseBody = await response.text()
  assert.equal(response.status(), 200, `Challenge moderation failed: ${response.status()} ${responseBody}`)
  await waitForText('Challenge moved to Open.')

  await clickLink('/challenges')
  await waitForText(title)
  await page.evaluate((expectedTitle) => {
    const link = [...document.querySelectorAll('a.challenge')].find((item) => item.textContent?.includes(expectedTitle))
    if (!(link instanceof HTMLAnchorElement)) throw new Error('Published challenge link not found')
    link.click()
  }, title)
  await waitForText('Students cross a fast road')
  await waitForText('Open')

  assert.deepEqual(apiFailures, [], `API failures: ${apiFailures.join(', ')}`)
  assert.ok(apiCalls.some((call) => call === 'POST /api/auth/request-code 202'))
  assert.ok(apiCalls.some((call) => call === 'POST /api/auth/verify-code 200'))
  assert.ok(apiCalls.some((call) => call === 'POST /api/challenges 201'))
  assert.ok(apiCalls.some((call) => /PATCH \/api\/challenges\/.+\/status 200/.test(call)))
  console.log('Browser workflow passed: admin login, challenge submission, moderation, and rendered challenge details.')
  console.log(`Verified API responses: ${apiCalls.length}`)
} catch (error) {
  console.error('API responses before failure:', apiCalls.join('\n'))
  console.error('API failures before failure:', apiFailures.join('\n'))
  throw error
} finally {
  await browser.close()
}
