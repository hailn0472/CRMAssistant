import { expect, test, type BrowserContext } from '@playwright/test'
import { execFileSync } from 'child_process'
import path from 'path'
import { applyAuthCookie } from '../support/helpers/auth'

// =============================================================================
// Story 4.3: Calendar Integration (Google Calendar & Outlook) — E2E Spec
// =============================================================================
// Runs against the REAL dev stack (web :3000 + api :4000) with the seeded dev
// database. Covers the UI-facing acceptance criteria (sections G-H, AC 40-47):
//
//   AC 40 — /settings/calendars renders one row per provider (Google, Outlook)
//           with Connect / Connected-with-status (Connected | Degraded |
//           Disconnected vocabulary, colour paired with text), last-synced
//           timestamp, Sync now button and Disconnect behind a confirm whose
//           copy states the real impact (tasks stop syncing, events already in
//           the calendar are LEFT IN PLACE).
//   AC 41 — the OAuth callback route handles ?error=access_denied as a calm,
//           non-scary message (plus the other client-side error branches).
//   AC 42 — Settings layout shows a Calendars nav entry with no role /
//           permission gating.
//   AC 43 — Breadcrumb labels: /settings/calendars renders "Calendars".
//   AC 45-46 — TaskCalendarSyncBadge on the task detail page: Not-connected
//           state (quiet link to /settings/calendars), Synced (provider name +
//           time), Failed (lastError + Retry button calling syncTaskToCalendar).
//
// REALITY CONSTRAINT (documented): the app talks to real Google/Microsoft
// OAuth which cannot be completed in E2E (no real credentials, no browser
// interaction with the provider consent screen). Covered through the real UI:
// the not-connected state, the callback error paths (no provider call), and —
// via one-shot Prisma seeding of CalendarConnection rows with fake-but-valid-
// shape tokens (the page/panel only ever reads non-token fields; AC 5/33) —
// the Connected / Degraded badges, Sync now and the Disconnect confirm.
//
// Auth model (proven on 4-1/4-2/3-7): the browser sends a hand-signed JWT in
// the httpOnly `auth-token` cookie (middleware-verified, secret matches
// Infisical). Grants resolve server-side from DB role rows by userId; real
// user ids are resolved at setup via POST /auth/login (seed assigns random
// UUIDs — hardcoding them breaks on every fresh DB).
//
// Seeding: CalendarConnection rows have no public GraphQL mutation that fits
// E2E (connectCalendar needs a real OAuth code), so connected-state fixtures
// are upserted via a one-shot Prisma write through `infisical run` (the same
// pattern as 4-2's Conversation/zero-activity contact rows). Every DB-only
// row for a test is written in ONE invocation (Supabase pooler is flaky under
// parallel infisical writes) and cleaned up in afterEach/afterAll. Tokens are
// fake strings — the sync engine may mark a connection Degraded when it tries
// to use them; tests only assert the UI vocabulary, never a live sync result.
// =============================================================================

test.describe.configure({ mode: 'serial', retries: 1 })
test.use({ navigationTimeout: 60_000 })

const BACKEND_URL = 'http://127.0.0.1:4000/graphql'
const AUTH_LOGIN_URL = 'http://127.0.0.1:4000/auth/login'
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const DEMO_PASSWORD = 'Demo@123456'
const REPO_ROOT = process.cwd()

// Resolved at runtime from /auth/login (seed assigns random UUIDs).
let ADMIN_USER = ''
let adminToken = ''
let setupFailed = false

/** Task ids created via the API for the badge tests (cleaned in afterAll). */
const createdTaskIds: string[] = []

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Real-user login with retry/backoff (Supabase Auth 500s under concurrent load). */
async function apiLogin(
  client: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<{ userId: string; accessToken: string }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await client.post(AUTH_LOGIN_URL, {
        headers: { 'Content-Type': 'application/json' },
        data: { email, password: DEMO_PASSWORD },
      })
      const body = await res.json()
      if (res.ok() && body?.userId && body?.accessToken) {
        return { userId: body.userId as string, accessToken: body.accessToken as string }
      }
      lastError = new Error(`login failed for ${email}: ${res.status()} ${JSON.stringify(body)}`)
    } catch (err: unknown) {
      lastError = err
    }
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function apiGraphql(
  client: import('@playwright/test').APIRequestContext,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await client.post(BACKEND_URL, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    data: { query, variables },
  })
  return { status: res.status(), body: await res.json() }
}

async function authAs(context: BrowserContext, userId: string, email: string): Promise<void> {
  process.env['JWT_SECRET'] = API_JWT_SECRET
  process.env['PLAYWRIGHT_USER_ID'] = userId
  process.env['PLAYWRIGHT_EMAIL'] = email
  await applyAuthCookie(context)
}

/**
 * One-shot Prisma write through `infisical run` (cwd = apps/api so
 * @prisma/client resolves). Retried with backoff — parallel invocations hit
 * the Supabase pooler limit transiently ("failed to wait for command
 * termination").
 */
function apiNodeWrite(script: string): string {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return execFileSync(
        'infisical',
        ['run', '--env=dev', '--path=/apps/api', '--', 'node', '-e', script],
        { cwd: path.join(REPO_ROOT, 'apps/api'), encoding: 'utf8', timeout: 120_000 },
      )
    } catch (err: unknown) {
      lastError = err
      if (attempt < 3) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * 2 ** (attempt - 1))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

interface SeedConnection {
  provider: 'GOOGLE' | 'OUTLOOK'
  status: string
  lastSyncError: string | null
  email: string
}

/**
 * Upserts CalendarConnection rows (and optionally a TaskCalendarEvent link)
 * for the E2E admin user in ONE Prisma invocation. Fake-but-valid-shape
 * tokens — the panel only reads non-token fields (AC 5/33). The update branch
 * revives soft-deleted rows (deletedAt: null, like the service's upsert, AC 18).
 */
function seedScript(args: {
  tenantId: string
  userId: string
  connections: SeedConnection[]
  taskLink?: { taskId: string; syncStatus: 'SYNCED' | 'FAILED'; lastError: string | null }
}): string {
  const { tenantId, userId, connections, taskLink } = args
  return `
const { PrismaClient } = require('@prisma/client')
const url = process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&connection_limit=1' : '?connection_limit=1')
const p = new PrismaClient({ datasources: { db: { url } } })
const tenantId = ${JSON.stringify(tenantId)}
const userId = ${JSON.stringify(userId)}
const connections = ${JSON.stringify(connections)}
const taskLink = ${JSON.stringify(taskLink ?? null)}
async function main() {
  const connIds = {}
  for (const c of connections) {
    const conn = await p.calendarConnection.upsert({
      where: { tenantId_userId_provider: { tenantId, userId, provider: c.provider } },
      create: {
        tenantId, userId, provider: c.provider,
        externalAccountId: 'e2e-' + c.provider.toLowerCase(),
        externalAccountEmail: c.email,
        accessTokenEncrypted: 'fake', refreshTokenEncrypted: 'fake',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        calendarId: 'primary', status: c.status,
        lastSyncedAt: new Date(), lastSyncError: c.lastSyncError,
        createdBy: userId, updatedBy: userId,
      },
      update: {
        deletedAt: null, status: c.status, lastSyncError: c.lastSyncError,
        lastSyncedAt: new Date(),
        accessTokenEncrypted: 'fake', refreshTokenEncrypted: 'fake',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        updatedBy: userId,
      },
    })
    connIds[c.provider] = conn.id
  }
  if (taskLink && connIds['GOOGLE']) {
    await p.taskCalendarEvent.upsert({
      where: { tenantId_taskId_calendarConnectionId: { tenantId, taskId: taskLink.taskId, calendarConnectionId: connIds['GOOGLE'] } },
      create: {
        tenantId, taskId: taskLink.taskId, calendarConnectionId: connIds['GOOGLE'],
        externalEventId: 'e2e-ev-' + taskLink.syncStatus,
        syncStatus: taskLink.syncStatus, lastError: taskLink.lastError,
        attemptCount: taskLink.syncStatus === 'FAILED' ? 1 : 0,
        localSyncedAt: new Date(),
        createdBy: userId, updatedBy: userId,
      },
      update: {
        syncStatus: taskLink.syncStatus, lastError: taskLink.lastError,
        externalEventId: 'e2e-ev-' + taskLink.syncStatus, localSyncedAt: new Date(),
      },
    })
  }
  console.log('calendar seed ok')
}
main().catch((e) => { console.error(e.message); process.exit(1) }).finally(() => p.$disconnect())
`
}

/** Deletes every CalendarConnection row for the user (link rows CASCADE). */
function cleanupScript(tenantId: string, userId: string): string {
  return `
const { PrismaClient } = require('@prisma/client')
const url = process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&connection_limit=1' : '?connection_limit=1')
const p = new PrismaClient({ datasources: { db: { url } } })
async function main() {
  await p.calendarConnection.deleteMany({ where: { tenantId: ${JSON.stringify(tenantId)}, userId: ${JSON.stringify(userId)} } })
  console.log('calendar cleanup ok')
}
main().catch((e) => { console.error(e.message); process.exit(1) }).finally(() => p.$disconnect())
`
}

/** Creates a task through the real API as admin. */
async function createTaskViaApi(
  request: import('@playwright/test').APIRequestContext,
  overrides: { title: string; dueDate?: string; assignedTo?: string },
): Promise<{ id: string; title: string }> {
  const created = await apiGraphql(
    request,
    adminToken,
    /* GraphQL */ `
      mutation CreateTask($input: CreateTaskInput!) {
        createTask(input: $input) {
          id
          title
          status
          dueDate
        }
      }
    `,
    { input: overrides },
  )
  const task = created.body?.data?.createTask
  if (!task?.id) {
    throw new Error(`createTask failed: ${JSON.stringify(created.body)}`)
  }
  createdTaskIds.push(task.id as string)
  return { id: task.id as string, title: task.title as string }
}

/** Locators for one provider row on the settings/calendars table. */
function providerRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('tbody tr', { hasText: label })
}

test.describe('Calendar Integration — Story 4.3 (AC 40-47)', () => {
  test.beforeAll(async ({ request }) => {
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_TENANT_ID'] = TENANT_ID

    try {
      const admin = await apiLogin(request, 'admin@example.com')
      ADMIN_USER = admin.userId
      adminToken = admin.accessToken
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 4.3] Login unavailable for setup: ${msg}`)
      setupFailed = true
    }

    if (!setupFailed) {
      try {
        // Hard reset any leftover connection rows from a previous failed run
        // so the "no connections" baseline is real.
        apiNodeWrite(cleanupScript(TENANT_ID, ADMIN_USER))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[E2E 4.3] Connection cleanup in setup failed: ${msg}`)
      }
    }
  })

  test.beforeEach(async ({ context }) => {
    await authAs(context, ADMIN_USER, 'admin@example.com')
  })

  test.afterEach(() => {
    delete process.env['JWT_SECRET']
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
    // Every test leaves the admin's calendar state clean — the next test
    // starts from a real "no connections" baseline.
    if (ADMIN_USER) {
      try {
        apiNodeWrite(cleanupScript(TENANT_ID, ADMIN_USER))
      } catch {
        // Non-fatal: a leftover row would only affect tests that seed anyway.
      }
    }
  })

  test.afterAll(async ({ request }) => {
    if (ADMIN_USER) {
      try {
        apiNodeWrite(cleanupScript(TENANT_ID, ADMIN_USER))
      } catch {
        // Best effort.
      }
      for (const taskId of createdTaskIds) {
        await apiGraphql(
          request,
          adminToken,
          /* GraphQL */ `
            mutation DeleteTask($id: ID!) {
              deleteTask(id: $id)
            }
          `,
          { id: taskId },
        ).catch(() => undefined)
      }
    }
  })

  // =====================================================================
  // AC 42 — Settings layout: Calendars nav entry (no roles / no permission)
  // =====================================================================
  test('[P1] E2E-CAL-01: Settings layout shows a Calendars nav entry linking to /settings/calendars', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/settings')
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' })
    await expect(settingsNav).toBeVisible({ timeout: 30_000 })
    const link = settingsNav.getByRole('link', { name: 'Calendars', exact: true })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/settings/calendars')
    // No roles / no permission gating: visible for the plain admin cookie.
    await link.click()
    await expect(page).toHaveURL(/\/settings\/calendars$/)
  })

  // =====================================================================
  // AC 43 — Breadcrumb labels
  // =====================================================================
  test('[P1] E2E-CAL-02: Breadcrumb on /settings/calendars shows the Calendars label', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/settings/calendars')
    const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' })
    await expect(breadcrumb).toBeVisible({ timeout: 30_000 })
    await expect(breadcrumb).toContainText('Calendars')
  })

  // =====================================================================
  // AC 40 — Page renders, no-connection baseline
  // =====================================================================
  test('[P1] E2E-CAL-03: Calendars page renders both provider rows with Connect buttons and Not-connected status', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/settings/calendars')
    // Empty state for a user with no connections (AC 40 empty state).
    await expect(page.getByText('No calendars connected').first()).toBeVisible({
      timeout: 30_000,
    })

    const googleRow = providerRow(page, 'Google Calendar')
    const outlookRow = providerRow(page, 'Outlook Calendar')
    await expect(googleRow).toBeVisible()
    await expect(outlookRow).toBeVisible()

    // Both rows: "Not connected" status badge (colour paired with text) +
    // a Connect button.
    for (const row of [googleRow, outlookRow]) {
      await expect(row.getByText('Not connected')).toBeVisible()
      await expect(row.getByRole('button', { name: 'Connect' })).toBeVisible()
      // Not-connected rows must NOT show connected-only actions.
      await expect(row.getByRole('button', { name: 'Sync now' })).toHaveCount(0)
      await expect(row.getByRole('button', { name: 'Disconnect' })).toHaveCount(0)
    }
  })

  // =====================================================================
  // AC 40 — Connected state (seeded CalendarConnection)
  // =====================================================================
  test('[P1] E2E-CAL-04: Connected row shows Connected badge, last-synced timestamp and Sync now / Disconnect actions', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    apiNodeWrite(
      seedScript({
        tenantId: TENANT_ID,
        userId: ADMIN_USER,
        connections: [
          {
            provider: 'GOOGLE',
            status: 'ACTIVE',
            lastSyncError: null,
            email: 'e2e-google@test.local',
          },
        ],
      }),
    )
    await page.goto('/settings/calendars')

    const googleRow = providerRow(page, 'Google Calendar')
    await expect(googleRow).toBeVisible({ timeout: 30_000 })
    await expect(googleRow.getByText('Connected')).toBeVisible()
    // Last-synced timestamp rendered (seeded to now → "Last synced …").
    await expect(googleRow.getByText(/Last synced/)).toBeVisible()
    await expect(googleRow.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await expect(googleRow.getByRole('button', { name: 'Disconnect' })).toBeVisible()
    // The other provider row is still not connected (per-provider state).
    const outlookRow = providerRow(page, 'Outlook Calendar')
    await expect(outlookRow.getByText('Not connected')).toBeVisible()
    await expect(outlookRow.getByRole('button', { name: 'Connect' })).toBeVisible()
  })

  test('[P1] E2E-CAL-05: Connection with lastSyncError shows Degraded badge and the error text', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    apiNodeWrite(
      seedScript({
        tenantId: TENANT_ID,
        userId: ADMIN_USER,
        connections: [
          {
            provider: 'OUTLOOK',
            status: 'ACTIVE',
            lastSyncError: 'e2e fake sync error',
            email: 'e2e-outlook@test.local',
          },
        ],
      }),
    )
    await page.goto('/settings/calendars')

    const outlookRow = providerRow(page, 'Outlook Calendar')
    await expect(outlookRow).toBeVisible({ timeout: 30_000 })
    // Degraded = ACTIVE + lastSyncError (AC 4 vocabulary), colour paired
    // with text, and the error message rendered as visible text.
    await expect(outlookRow.getByText('Degraded')).toBeVisible()
    await expect(outlookRow.getByText('e2e fake sync error')).toBeVisible()
    // Degraded rows still expose Sync now / Disconnect.
    await expect(outlookRow.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await expect(outlookRow.getByRole('button', { name: 'Disconnect' })).toBeVisible()
  })

  test('[P1] E2E-CAL-06: Sync now calls syncCalendar and shows impact-copy success toast', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    apiNodeWrite(
      seedScript({
        tenantId: TENANT_ID,
        userId: ADMIN_USER,
        connections: [
          {
            provider: 'GOOGLE',
            status: 'ACTIVE',
            lastSyncError: null,
            email: 'e2e-google@test.local',
          },
        ],
      }),
    )
    await page.goto('/settings/calendars')

    const googleRow = providerRow(page, 'Google Calendar')
    await expect(googleRow.getByRole('button', { name: 'Sync now' })).toBeVisible({
      timeout: 30_000,
    })
    // The mutation is real; the fake token makes the actual provider sync
    // fail server-side, but syncProvider is best-effort and never throws —
    // the mutation resolves true and the success toast (impact copy, not
    // just "Saved") is what the user sees.
    await googleRow.getByRole('button', { name: 'Sync now' }).click()
    await expect(page.getByText('Calendar synced — task changes now flow both ways')).toBeVisible({
      timeout: 15_000,
    })
  })

  test('[P1] E2E-CAL-07: Disconnect confirm states real impact and disconnect flips the row back to Not connected', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    apiNodeWrite(
      seedScript({
        tenantId: TENANT_ID,
        userId: ADMIN_USER,
        connections: [
          {
            provider: 'GOOGLE',
            status: 'ACTIVE',
            lastSyncError: null,
            email: 'e2e-google@test.local',
          },
        ],
      }),
    )
    await page.goto('/settings/calendars')

    const googleRow = providerRow(page, 'Google Calendar')
    await expect(googleRow.getByRole('button', { name: 'Disconnect' })).toBeVisible({
      timeout: 30_000,
    })

    // The confirm copy must state the real impact (AC 19/40): tasks stop
    // syncing AND events already in the calendar are LEFT IN PLACE.
    let confirmMessage = ''
    page.once('dialog', (dialog) => {
      confirmMessage = dialog.message()
      void dialog.accept()
    })
    await googleRow.getByRole('button', { name: 'Disconnect' }).click()
    expect(confirmMessage).toContain('Tasks will stop syncing')
    expect(confirmMessage).toContain('left in place')
    expect(confirmMessage).toContain('Google Calendar')

    // Success copy states impact (existing events kept), then the refetch
    // flips the row back to Not connected + Connect.
    await expect(
      page.getByText('Google Calendar disconnected — existing calendar events were kept'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(googleRow.getByText('Not connected')).toBeVisible({ timeout: 15_000 })
    await expect(googleRow.getByRole('button', { name: 'Connect' })).toBeVisible()
  })

  // =====================================================================
  // AC 41 — OAuth callback route (client-side error branches, no provider
  // call — the success path needs a real OAuth code and cannot run in E2E)
  // =====================================================================
  test('[P1] E2E-CAL-08: Callback with ?error=access_denied shows a calm message and redirects to /settings/calendars', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/settings/calendars/callback?error=access_denied')
    // Non-scary copy — the user-denied case is a normal flow, not an error
    // boundary (AC 41).
    await expect(page.getByText('Calendar connection cancelled — nothing was changed')).toBeVisible(
      { timeout: 15_000 },
    )
    await expect(page).toHaveURL(/\/settings\/calendars$/, { timeout: 15_000 })
  })

  test('[P1] E2E-CAL-09: Callback with an unexpected error shows a calm failure toast', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/settings/calendars/callback?error=server_error')
    await expect(page.getByText('Calendar connection failed — please try again')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page).toHaveURL(/\/settings\/calendars$/, { timeout: 15_000 })
  })

  test('[P1] E2E-CAL-10: Callback with missing code/state shows a calm cannot-complete message', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/settings/calendars/callback')
    await expect(
      page.getByText('Calendar connection could not be completed — please try again'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/settings\/calendars$/, { timeout: 15_000 })
  })

  // =====================================================================
  // AC 45-46 — TaskCalendarSyncBadge on the task detail page
  // =====================================================================
  test('[P1] E2E-CAL-11: Task detail shows Not-connected badge with a quiet Connect link when the assignee has no connection', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const { id } = await createTaskViaApi(request, {
      title: `e2e-cal-not-connected-${uniqueSuffix()}`,
      dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      assignedTo: ADMIN_USER,
    })

    await page.goto(`/tasks/${id}`)
    // The badge renders "Not synced to calendar" — a quiet state, not an
    // error — with a link to the settings page (AC 45).
    await expect(page.getByText('Not synced to calendar')).toBeVisible({ timeout: 30_000 })
    const connectLink = page.getByRole('link', { name: 'Connect', exact: true })
    await expect(connectLink).toBeVisible()
    await expect(connectLink).toHaveAttribute('href', '/settings/calendars')
  })

  test('[P1] E2E-CAL-12: Task detail badge shows Synced with the provider name for a SYNCED link row', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    // Create the task BEFORE seeding the connection so the push hook finds
    // no connection and leaves no link row; the link row is then seeded
    // directly (fake tokens — the badge only reads non-token fields).
    const { id } = await createTaskViaApi(request, {
      title: `e2e-cal-synced-${uniqueSuffix()}`,
      dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      assignedTo: ADMIN_USER,
    })
    apiNodeWrite(
      seedScript({
        tenantId: TENANT_ID,
        userId: ADMIN_USER,
        connections: [
          {
            provider: 'GOOGLE',
            status: 'ACTIVE',
            lastSyncError: null,
            email: 'e2e-google@test.local',
          },
        ],
        taskLink: { taskId: id, syncStatus: 'SYNCED', lastError: null },
      }),
    )

    await page.goto(`/tasks/${id}`)
    // Synced badge carries the provider name and the last-synced time (AC 45);
    // the span renders as one text node ("Synced · Google Calendar · <time>").
    await expect(page.getByText(/^Synced/).first()).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText('Google Calendar').first()).toBeVisible()
  })

  test('[P1] E2E-CAL-13: Task detail badge shows Sync failed with lastError and a Retry button for a FAILED link row', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const { id } = await createTaskViaApi(request, {
      title: `e2e-cal-failed-${uniqueSuffix()}`,
      dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      assignedTo: ADMIN_USER,
    })
    apiNodeWrite(
      seedScript({
        tenantId: TENANT_ID,
        userId: ADMIN_USER,
        connections: [
          {
            provider: 'GOOGLE',
            status: 'ACTIVE',
            lastSyncError: null,
            email: 'e2e-google@test.local',
          },
        ],
        taskLink: { taskId: id, syncStatus: 'FAILED', lastError: 'e2e fake push error' },
      }),
    )

    await page.goto(`/tasks/${id}`)
    await expect(page.getByText(/^Sync failed/).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('e2e fake push error')).toBeVisible()
    const retryButton = page.getByRole('button', { name: 'Retry', exact: true })
    await expect(retryButton).toBeVisible()

    // Retry fires the syncTaskToCalendar mutation (AC 46 wiring). The fake
    // token keeps the row FAILED — we assert the mutation is issued and the
    // badge stays in a sane state, not a live sync result.
    const mutation = page.waitForResponse(
      (r) =>
        r.url().includes('/api/graphql') &&
        r.request().postData()?.includes('SyncTaskToCalendar') === true,
      { timeout: 15_000 },
    )
    await retryButton.click()
    await mutation
    await expect(page.getByText(/^Sync failed/).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  })
})
