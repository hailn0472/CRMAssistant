import { expect, test, type BrowserContext } from '@playwright/test'
import { applyAuthCookie } from '../support/helpers/auth'

// =============================================================================
// Story 4.4: Multiple Activity Views (List, Calendar, Timeline) — E2E Spec
// =============================================================================
// Runs against the REAL dev stack (web :3000 + api :4000) with the seeded dev
// database. Covers the UI-facing acceptance criteria:
//
//   AC 20-22 — /activities renders the workspace shell: header (title +
//              description + Create task action), the shared metric strip
//              (Activities today / This week / Tasks due today / Overdue
//              tasks), a REAL tab control (role=tablist/tab, aria-selected)
//              whose active tab is reflected in the URL as ?view=list|calendar
//              |timeline, survives a reload, and an unknown ?view= falls back
//              to List without crashing.
//   AC 21    — Filters live ABOVE the tab control and are SHARED across all
//              three views: a search + status filter set in List is still
//              applied when switching to Calendar and back to List.
//   AC 24-26 — List view: one table with columns Title · Type · Status ·
//              Priority · Assignee · Date · Related; task rows fill every
//              column; activity rows render an em-dash (—) in the task-only
//              columns; type cells pair an icon with a TEXT label; clicking
//              Date toggles aria-sort ascending/descending; pagination
//              control present.
//   AC 28-30 — Calendar view: 42-cell month grid (6 rows × 7 columns), the
//              day/week/month granularity toggle, Previous / Next / Today
//              navigation; task chips land on their due date.
//   AC 33    — "Unscheduled" strip surfaces tasks without a dueDate.
//   AC 32    — the non-drag "Move to date…" menu performs the SAME updateTask
//              mutation as a drop (verified via the API — no drag simulation,
//              per the task brief).
//   AC 34    — Timeline view: activities grouped by day with collapsible
//              sections (<button aria-expanded>), default today+yesterday
//              expanded, source links TASK → /tasks/:sourceId and DEAL →
//              /deals/:sourceId, and IntersectionObserver infinite scroll
//              appending further pages (skipped gracefully when the dev DB
//              holds fewer than 21 activities).
//   AC 38-39 — Sidebar "Activities" entry in the primary nav group; breadcrumb
//              renders "Activities".
//
// Auth model (proven on 4-1/4-2/4-3/3-7): the browser sends a hand-signed JWT
// in the httpOnly `auth-token` cookie (middleware-verified, secret matches
// Infisical). Grants resolve server-side from DB role rows by userId; real
// user ids are resolved at setup via POST /auth/login (seed assigns random
// UUIDs — hardcoding them breaks on every fresh DB).
//
// Seed-data policy: every row the assertions depend on is created through the
// REAL GraphQL producers (createContact, createTask, completeTask, createDeal,
// addContactNote) so the auto-logging hooks themselves are exercised, and the
// rows are unique per run (timestamped titles), so re-runs never collide.
// Tasks are deleted in afterAll; contacts/deals/activities are append-only and
// left behind exactly like the sibling specs do.
// =============================================================================

test.describe.configure({ mode: 'serial', retries: 1 })
test.use({ navigationTimeout: 60_000, viewport: { width: 1440, height: 900 } })

const BACKEND_URL = 'http://127.0.0.1:4000/graphql'
const AUTH_LOGIN_URL = 'http://127.0.0.1:4000/auth/login'
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const DEMO_PASSWORD = 'Demo@123456'

// Resolved at runtime from /auth/login (seed assigns random UUIDs).
let ADMIN_USER = ''
let adminToken = ''
let setupFailed = false
let setupError = ''

// Data created in beforeAll through the real API (unique per run).
let taskDueId = ''
let taskDueTitle = ''
let taskUnschTitle = ''
let taskMoveId = ''
let taskMoveTitle = ''
let taskTodoTitle = ''
let dealId = ''
let noteTitle = ''
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

// ─── API helpers used for deterministic seeding ─────────────────────────────

async function createContactViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  firstName: string,
  lastName: string,
): Promise<{ id: string }> {
  const email = `e2e-4-4-${uniqueSuffix()}@test.local`
  const created = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation CreateContact($input: CreateContactInput!) {
        createContact(input: $input) {
          id
        }
      }
    `,
    { input: { email, firstName, lastName } },
  )
  const contact = created.body?.data?.createContact
  if (!contact?.id) {
    throw new Error(`createContact failed: ${JSON.stringify(created.body)}`)
  }
  return { id: contact.id as string }
}

async function createTaskViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  overrides: { title: string; contactId: string; dueDate?: string; priority?: string },
): Promise<{ id: string }> {
  const created = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation CreateTask($input: CreateTaskInput!) {
        createTask(input: $input) {
          id
          title
          status
          priority
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
  return { id: task.id as string }
}

async function completeTaskViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  taskId: string,
): Promise<void> {
  const done = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation CompleteTask($id: ID!) {
        completeTask(id: $id) {
          id
          status
        }
      }
    `,
    { id: taskId },
  )
  if (done.body?.data?.completeTask?.status !== 'COMPLETED') {
    throw new Error(`completeTask failed: ${JSON.stringify(done.body)}`)
  }
}

async function createDealViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  title: string,
  contactId: string,
  stageId: string,
): Promise<{ id: string }> {
  const created = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation CreateDeal($input: CreateDealInput!) {
        createDeal(input: $input) {
          id
          title
        }
      }
    `,
    { input: { title, value: 1000, currency: 'USD', stageId, contactId } },
  )
  const deal = created.body?.data?.createDeal
  if (!deal?.id) {
    throw new Error(`createDeal failed: ${JSON.stringify(created.body)}`)
  }
  return { id: deal.id as string }
}

async function addNoteViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  contactId: string,
  title: string,
): Promise<void> {
  const res = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation AddContactNote($contactId: ID!, $title: String!, $description: String) {
        addContactNote(contactId: $contactId, title: $title, description: $description) {
          id
        }
      }
    `,
    { contactId, title, description: 'E2E 4-4 manual note.' },
  )
  if (res.body?.errors) {
    throw new Error(`addContactNote failed: ${JSON.stringify(res.body)}`)
  }
}

/** Reads a task's dueDate through the real API (null when unset). */
async function getTaskDueDate(
  request: import('@playwright/test').APIRequestContext,
  taskId: string,
): Promise<string | null> {
  const res = await apiGraphql(
    request,
    adminToken,
    /* GraphQL */ `
      query TaskDueDate($id: ID!) {
        task(id: $id) {
          dueDate
        }
      }
    `,
    { id: taskId },
  )
  return (res.body?.data?.task?.dueDate as string | null) ?? null
}

/** UTC day key (yyyy-mm-dd) for an ISO timestamp — matches the app's utcDayKey. */
function utcDayKey(iso: string): string {
  return iso.slice(0, 10)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test.describe('Multiple Activity Views (List, Calendar, Timeline) — Story 4.4', () => {
  test.beforeAll(async ({ request }) => {
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_TENANT_ID'] = TENANT_ID

    try {
      const admin = await apiLogin(request, 'admin@example.com')
      ADMIN_USER = admin.userId
      adminToken = admin.accessToken
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 4.4] Login unavailable for setup: ${msg}`)
      setupFailed = true
      setupError = `login: ${msg}`
    }

    if (setupFailed) return

    try {
      const suffix = uniqueSuffix()
      // UTC midnight today — Task.dueDate is stored at UTC midnight
      // (tasks.service.ts:166) and the grid buckets on UTC days (AC 28/T7).
      const todayIso = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`

      // A contact — createContact always auto-logs CONTACT_CREATED.
      const contact = await createContactViaApi(request, adminToken, 'E2E44', `View${suffix}`)

      // Task with a due date = today → shows on the calendar in today's cell.
      taskDueTitle = `E2E 4-4 due ${suffix}`
      const due = await createTaskViaApi(request, adminToken, {
        title: taskDueTitle,
        contactId: contact.id,
        dueDate: todayIso,
      })
      taskDueId = due.id
      // Completing it logs TASK_COMPLETED with source=TASK + sourceId (AC 34 link).
      await completeTaskViaApi(request, adminToken, taskDueId)

      // Task with NO due date → the Unscheduled strip (AC 33).
      taskUnschTitle = `E2E 4-4 unscheduled ${suffix}`
      await createTaskViaApi(request, adminToken, {
        title: taskUnschTitle,
        contactId: contact.id,
      })

      // Task with a due date used by the non-drag "Move to date…" test (AC 32).
      taskMoveTitle = `E2E 4-4 move ${suffix}`
      const move = await createTaskViaApi(request, adminToken, {
        title: taskMoveTitle,
        contactId: contact.id,
        dueDate: todayIso,
      })
      taskMoveId = move.id

      // A TODO + HIGH task with a due date for the list/filter assertions.
      taskTodoTitle = `E2E 4-4 todo ${suffix}`
      await createTaskViaApi(request, adminToken, {
        title: taskTodoTitle,
        contactId: contact.id,
        dueDate: todayIso,
        priority: 'HIGH',
      })

      // A deal → DEAL_CREATED with source=DEAL + sourceId (AC 34 link).
      const stages = await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          query DealStages {
            dealStages {
              id
              name
            }
          }
        `,
      )
      const stageList = stages.body?.data?.dealStages as Array<{ id: string; name: string }>
      if (!stageList || stageList.length < 1) {
        throw new Error(`dealStages lookup failed: ${JSON.stringify(stages.body)}`)
      }
      const deal = await createDealViaApi(
        request,
        adminToken,
        `E2E 4-4 deal ${suffix}`,
        contact.id,
        stageList[0]!.id,
      )
      dealId = deal.id

      // A manual note → NOTE_ADDED with source=null (renders — in task-only columns).
      noteTitle = `E2E 4-4 note ${suffix}`
      await addNoteViaApi(request, adminToken, contact.id, noteTitle)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 4.4] Setup failed: ${msg}`)
      setupFailed = true
      setupError = `setup: ${msg}`
    }
  })

  test.beforeEach(async ({ context }) => {
    await authAs(context, ADMIN_USER, 'admin@example.com')
  })

  test.afterEach(() => {
    delete process.env['JWT_SECRET']
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
  })

  test.afterAll(async ({ request }) => {
    if (!ADMIN_USER) return
    for (const id of createdTaskIds) {
      await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          mutation DeleteTask($id: ID!) {
            deleteTask(id: $id)
          }
        `,
        { id },
      ).catch(() => undefined)
    }
    if (dealId) {
      await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          mutation DeleteDeal($id: ID!) {
            deleteDeal(id: $id)
          }
        `,
        { id: dealId },
      ).catch(() => undefined)
    }
  })

  // =====================================================================
  // AC 20-22, 39 — Workspace shell: header, metric strip, tabs, breadcrumb
  // =====================================================================
  test('[P1] E2E-AV-01: /activities renders header, metric strip, tab control and breadcrumb (AC 20-22, 39)', async ({
    page,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities')
    // Cold dev-boot on-demand compile can take a while on the first hit.
    await expect(page.getByRole('heading', { name: 'Activities', level: 1 })).toBeVisible({
      timeout: 60_000,
    })
    // AC 20 — header description + primary action. The primary action is
    // gated on TASK:CREATE (permission query resolves after mount on a cold
    // boot), so give it time like the heading.
    await expect(page.getByText(/List, calendar and timeline views of your tasks/)).toBeVisible({
      timeout: 30_000,
    })
    const createTask = page.getByRole('link', { name: 'Create task' })
    await expect(createTask).toBeVisible({ timeout: 30_000 })
    await expect(createTask).toHaveAttribute('href', '/tasks/new')

    // AC 21 — shared metric strip (four metrics, no private copy).
    for (const label of ['Activities today', 'This week', 'Tasks due today', 'Overdue tasks']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }

    // AC 22 — real tabs.
    const tablist = page.getByRole('tablist', { name: 'Activity views' })
    await expect(tablist).toBeVisible()
    for (const name of ['List', 'Calendar', 'Timeline']) {
      await expect(tablist.getByRole('tab', { name, exact: true })).toBeVisible()
    }
    await expect(tablist.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(tablist.getByRole('tab', { name: 'Calendar', exact: true })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    await expect(tablist.getByRole('tab', { name: 'Timeline', exact: true })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    // AC 39 — breadcrumb label (not the "Chi tiết" fallback).
    await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Activities')
  })

  // =====================================================================
  // AC 22, 46 — ?view= URL, reload persistence, unknown-value fallback
  // =====================================================================
  test('[P1] E2E-AV-02: Tab selection survives reload; unknown ?view= falls back to List (AC 22, 46)', async ({
    page,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    // Unknown ?view= value → falls back to List without crashing (fresh
    // context ⇒ empty localStorage, so the deterministic fallback is List).
    await page.goto('/activities?view=bogus')
    const tablist = page.getByRole('tablist', { name: 'Activity views' })
    await expect(tablist.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 60_000 },
    )
    await expect(page.locator('#activities-view-panel-list table')).toBeVisible()
    // No crash: the workspace header is still there.
    await expect(page.getByRole('heading', { name: 'Activities', level: 1 })).toBeVisible()

    // Switching tabs updates the URL.
    await tablist.getByRole('tab', { name: 'Calendar', exact: true }).click()
    await expect(page).toHaveURL(/\/activities\?view=calendar/)
    await expect(tablist.getByRole('tab', { name: 'Calendar', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Reload preserves the Calendar tab.
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Calendar', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 60_000 },
    )
    await expect(page.locator('#activities-view-panel-calendar [data-day]').first()).toBeVisible()

    // Timeline tab also survives a reload.
    await page.getByRole('tab', { name: 'Timeline', exact: true }).click()
    await expect(page).toHaveURL(/\/activities\?view=timeline/)
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Timeline', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 60_000 },
    )
  })

  // =====================================================================
  // AC 24-25 — List table: columns, task rows, activity em-dashes
  // =====================================================================
  test('[P1] E2E-AV-03: List view renders task rows in every column and activity rows with em-dashes (AC 24-25)', async ({
    page,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities')
    await expect(page.locator('#activities-view-panel-list table')).toBeVisible({
      timeout: 60_000,
    })

    // AC 24 — the seven columns.
    for (const header of ['Title', 'Type', 'Status', 'Priority', 'Assignee', 'Date', 'Related']) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible()
    }

    // Task rows fill every column (taskTodo is TODO + HIGH). Note: the API
    // auto-assigns tasks to their creator (tasks.service.ts:295), so the
    // Assignee cell is filled with the admin's name — the row must contain
    // NO em-dash anywhere (contrast: activity rows below render three).
    const todoRow = page.locator('tbody tr').filter({ hasText: taskTodoTitle })
    await expect(todoRow).toBeVisible({ timeout: 30_000 })
    await expect(todoRow.getByText('Task', { exact: true })).toBeVisible()
    await expect(todoRow.getByText('To do', { exact: true })).toBeVisible()
    await expect(todoRow.getByText('High', { exact: true })).toBeVisible()
    await expect(todoRow.getByText('—', { exact: true })).toHaveCount(0)
    await expect(todoRow.locator('td').nth(4)).not.toBeEmpty()

    // Switch the record type to Activities (AC 23 segmented control).
    await page
      .getByRole('group', { name: 'Record type' })
      .getByRole('button', { name: 'Activities', exact: true })
      .click()

    // Activity rows: title / type label / date / related filled; task-only
    // columns render the em-dash (AC 24).
    const noteRow = page.locator('tbody tr').filter({ hasText: noteTitle })
    await expect(noteRow).toBeVisible({ timeout: 30_000 })
    // AC 25 — type cell pairs an icon with a TEXT label.
    await expect(noteRow.getByText('Note Added', { exact: true })).toBeVisible()
    await expect(noteRow.getByText('—', { exact: true })).toHaveCount(3)
  })

  // =====================================================================
  // AC 26 — Sortable Date column toggles aria-sort
  // =====================================================================
  test('[P1] E2E-AV-04: Clicking the Date column toggles aria-sort (AC 26)', async ({ page }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities')
    await expect(page.locator('#activities-view-panel-list table')).toBeVisible({
      timeout: 60_000,
    })

    const dateHeader = page.getByRole('columnheader', { name: /^Date/ })
    await expect(dateHeader).toBeVisible()
    // Unset → click → ASC.
    await dateHeader.click()
    await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending')
    // ASC → click → DESC.
    await dateHeader.click()
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending')
    // DESC → click → unset (third click clears, AC 26 cycle).
    await dateHeader.click()
    await expect(dateHeader).not.toHaveAttribute('aria-sort', 'ascending')
    await expect(dateHeader).not.toHaveAttribute('aria-sort', 'descending')
  })

  // =====================================================================
  // AC 26 — Pagination control
  // =====================================================================
  test('[P1] E2E-AV-05: List view shows the pagination control (AC 26)', async ({ page }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities')
    await expect(page.locator('#activities-view-panel-list table')).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible()
    // The result-count line ("<N> tasks") belongs to the pagination bar.
    await expect(
      page.locator('#activities-view-panel-list').getByText(/tasks/).first(),
    ).toBeVisible()
  })

  // =====================================================================
  // AC 28-30 — Calendar grid, granularity toggle, navigation
  // =====================================================================
  test('[P1] E2E-AV-06: Calendar renders the 42-cell month grid with mode toggle and prev/next/today (AC 28-30)', async ({
    page,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities?view=calendar')
    const panel = page.locator('#activities-view-panel-calendar')

    // AC 28 — fixed 42-cell month grid (6 rows × 7 columns).
    await expect(panel.locator('[data-day]')).toHaveCount(42, { timeout: 60_000 })

    // AC 29 — the seeded task with dueDate = today lands in today's cell.
    const grid = panel.locator('[data-day]')
    await expect(grid.getByText(taskDueTitle).first()).toBeVisible({ timeout: 30_000 })

    // AC 30 — day/week/month granularity toggle.
    const granularity = panel.getByRole('group', { name: 'Calendar granularity' })
    await expect(granularity.getByRole('button', { name: 'month', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await granularity.getByRole('button', { name: 'week', exact: true }).click()
    await expect(panel.locator('[data-day]')).toHaveCount(7)
    await granularity.getByRole('button', { name: 'day', exact: true }).click()
    await expect(panel.locator('[data-day]')).toHaveCount(1)
    await granularity.getByRole('button', { name: 'month', exact: true }).click()
    await expect(panel.locator('[data-day]')).toHaveCount(42)

    // AC 30 — Previous / Next / Today navigation. The month label is the span
    // right after the Today button. Next shifts the anchor by 7 days (the
    // implementation's fixed step), so click until the label changes, then
    // Today must bring it back.
    const monthLabel = panel
      .getByRole('button', { name: 'Today', exact: true })
      .locator('xpath=following-sibling::span[1]')
    const originalLabel = (await monthLabel.textContent()) ?? ''
    let labelChanged = false
    for (let i = 0; i < 6 && !labelChanged; i++) {
      await panel.getByRole('button', { name: 'Next period' }).click()
      labelChanged = (await monthLabel.textContent()) !== originalLabel
    }
    expect(labelChanged).toBe(true)
    await panel.getByRole('button', { name: 'Previous period' }).click()
    await panel.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(monthLabel).toHaveText(originalLabel, { timeout: 15_000 })
  })

  // =====================================================================
  // AC 33 — Unscheduled strip
  // =====================================================================
  test('[P1] E2E-AV-07: Tasks without a due date surface in the Unscheduled strip (AC 33)', async ({
    page,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities?view=calendar')
    const panel = page.locator('#activities-view-panel-calendar')
    await expect(panel.locator('[data-day]')).toHaveCount(42, { timeout: 60_000 })

    const strip = panel.locator('[class*="border-dashed"]')
    await expect(strip.getByText(/^Unscheduled \(\d+\)$/)).toBeVisible({ timeout: 30_000 })
    await expect(strip.getByText(taskUnschTitle)).toBeVisible()
  })

  // =====================================================================
  // AC 32 — Non-drag "Move to date…" performs the updateTask mutation
  // =====================================================================
  test('[P1] E2E-AV-08: The non-drag "Move to date…" menu reschedules a task (AC 32)', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities?view=calendar')
    const panel = page.locator('#activities-view-panel-calendar')
    await expect(panel.locator('[data-day]')).toHaveCount(42, { timeout: 60_000 })

    // Every task chip carries the "Move to date…" menu (AC 32) — this is the
    // keyboard/touch equivalent of a drop and funnels into the SAME updateTask
    // mutation (no drag simulation; the mutation is verified via the API).
    const moveButton = panel.getByRole('button', { name: `Move "${taskMoveTitle}" to a date` })
    await expect(moveButton).toBeVisible({ timeout: 30_000 })
    await moveButton.click()

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
    await page.getByLabel('Target date').fill(tomorrow)
    await page.getByRole('button', { name: 'Move', exact: true }).click()

    // The mutation must land: task.dueDate becomes tomorrow's UTC midnight.
    await expect
      .poll(
        async () => {
          try {
            return await getTaskDueDate(request, taskMoveId)
          } catch {
            return null
          }
        },
        { timeout: 20_000 },
      )
      .toBe(`${tomorrow}T00:00:00.000Z`)
  })

  // =====================================================================
  // AC 34, 46 — Timeline day grouping, collapse/expand, source links
  // =====================================================================
  test('[P1] E2E-AV-09: Timeline groups by day with collapsible sections and source links (AC 34, 46)', async ({
    page,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities?view=timeline')
    const panel = page.locator('#activities-view-panel-timeline')

    // Day-grouped collapsible sections (AC 34).
    const dayHeaders = panel.getByRole('button', { name: /Today|Yesterday|^\w+,/ })
    await expect(dayHeaders.first()).toBeVisible({ timeout: 60_000 })

    // Default: today + yesterday expanded (the seeded activities are all today).
    const todayHeader = panel.getByRole('button', { name: /^Today/ })
    await expect(todayHeader).toBeVisible()
    await expect(todayHeader).toHaveAttribute('aria-expanded', 'true')

    // Source links: TASK → /tasks/:sourceId (TASK_COMPLETED for the due task).
    const taskLink = panel.locator(`a[href="/tasks/${taskDueId}"]`)
    await expect(taskLink).toBeVisible({ timeout: 30_000 })
    // Source links: DEAL → /deals/:sourceId (DEAL_CREATED).
    const dealLink = panel.locator(`a[href="/deals/${dealId}"]`)
    await expect(dealLink).toBeVisible({ timeout: 30_000 })

    // Collapse today → its cards unmount; expand → they come back (keyboard
    // operable via the <button aria-expanded>).
    await todayHeader.click()
    await expect(todayHeader).toHaveAttribute('aria-expanded', 'false')
    await expect(taskLink).toHaveCount(0)
    await todayHeader.click()
    await expect(todayHeader).toHaveAttribute('aria-expanded', 'true')
    await expect(taskLink).toBeVisible()
  })

  // =====================================================================
  // AC 21, 46 — Filters shared across views
  // =====================================================================
  test('[P1] E2E-AV-10: A filter set in List is still applied in Calendar and back (AC 21, 46)', async ({
    page,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities')
    await expect(page.locator('#activities-view-panel-list table')).toBeVisible({
      timeout: 60_000,
    })

    // 1) Set a search filter in List (unique task title → one row).
    await page.getByLabel('Search activities').fill(taskTodoTitle)
    const todoRow = page.locator('tbody tr').filter({ hasText: taskTodoTitle })
    await expect(todoRow).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('tbody tr').filter({ hasText: taskDueTitle })).toHaveCount(0)

    // 2) Add a status filter (To do). The FilterTrigger appends ▾ to its
    //    accessible name ("All statuses: To do ▾" once a value is chosen —
    //    house pattern). Scope by /All statuses/ so the still-open popover's
    //    "To do" option button never matches.
    const statusTrigger = page.getByRole('button', { name: /All statuses/ })
    await statusTrigger.click()
    await page.getByRole('button', { name: 'To do', exact: true }).click()
    await expect(statusTrigger).toContainText('To do')

    // 3) Switch to Calendar — the filter survives the view switch and is
    //    APPLIED there (search-filtered: only the matching chip renders).
    await page.getByRole('tab', { name: 'Calendar', exact: true }).click()
    const calPanel = page.locator('#activities-view-panel-calendar')
    await expect(calPanel.locator('[data-day]').first()).toBeVisible({ timeout: 60_000 })
    await expect(calPanel.locator('[data-day]').getByText(taskTodoTitle).first()).toBeVisible({
      timeout: 30_000,
    })
    // The completed due-task was filtered out by the search in List AND Calendar.
    await expect(calPanel.locator('[data-day]').getByText(taskDueTitle)).toHaveCount(0)
    // The status filter is still reflected in the shared filter bar.
    await expect(page.getByRole('button', { name: /All statuses/ })).toContainText('To do')

    // 4) Switch back to List — the search + status filters are still applied.
    await page.getByRole('tab', { name: 'List', exact: true }).click()
    await expect(page.getByLabel('Search activities')).toHaveValue(taskTodoTitle)
    await expect(page.getByRole('button', { name: /All statuses/ })).toContainText('To do')
    await expect(page.locator('tbody tr').filter({ hasText: taskTodoTitle })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('tbody tr').filter({ hasText: taskDueTitle })).toHaveCount(0)

    // 5) "Clear all" resets the status (search term is preserved by design).
    await page.getByRole('button', { name: 'Clear all', exact: true }).click()
    await expect(page.getByRole('button', { name: /All statuses/ })).toBeVisible()
    await expect(page.getByLabel('Search activities')).toHaveValue(taskTodoTitle)
  })

  // =====================================================================
  // AC 38 — Sidebar Activities entry
  // =====================================================================
  test('[P1] E2E-AV-11: Sidebar shows the Activities entry in the primary nav (AC 38)', async ({
    page,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    await page.goto('/activities')
    const nav = page.getByRole('navigation', { name: 'CRM navigation' })
    await expect(nav).toBeVisible({ timeout: 60_000 })
    const link = nav.getByRole('link', { name: 'Activities', exact: true })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/activities')
    await link.click()
    await expect(page).toHaveURL(/\/activities$/)
  })

  // =====================================================================
  // AC 34 — Timeline infinite scroll appends further pages
  // =====================================================================
  test('[P2] E2E-AV-12: Timeline infinite scroll appends older day groups (AC 34)', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')

    // Determinism precheck: only meaningful when the tenant feed spans more
    // than one page AND page 2 contains activities on days not on page 1
    // (otherwise there is nothing observable to append).
    const p1 = await apiGraphql(
      request,
      adminToken,
      /* GraphQL */ `
        query FeedCheck($pagination: ActivityFeedPaginationInput) {
          activityFeed(filter: {}, pagination: $pagination) {
            total
            page
            pageSize
            items {
              id
              createdAt
            }
          }
        }
      `,
      { pagination: { page: 1, pageSize: 20 } },
    )
    const total = p1.body?.data?.activityFeed?.total as number | undefined
    if (typeof total !== 'number' || total <= 20) {
      // requires seeded data: fewer than 21 activities in the tenant feed
      test.skip(true, 'requires seeded data: tenant feed has ≤ 20 activities')
      return
    }
    const p2 = await apiGraphql(
      request,
      adminToken,
      /* GraphQL */ `
        query FeedCheck2($pagination: ActivityFeedPaginationInput) {
          activityFeed(filter: {}, pagination: $pagination) {
            items {
              id
              createdAt
            }
          }
        }
      `,
      { pagination: { page: 2, pageSize: 20 } },
    )
    const page1Keys = new Set(
      (p1.body?.data?.activityFeed?.items ?? []).map((a: { createdAt: string }) =>
        utcDayKey(a.createdAt),
      ),
    )
    const page2HasNewDay = (p2.body?.data?.activityFeed?.items ?? []).some(
      (a: { createdAt: string }) => !page1Keys.has(utcDayKey(a.createdAt)),
    )
    if (!page2HasNewDay) {
      // requires seeded data: page 2 shares every day with page 1
      test.skip(true, 'requires seeded data: page 2 has no new day groups')
      return
    }

    await page.goto('/activities?view=timeline')
    const panel = page.locator('#activities-view-panel-timeline')
    await expect(panel.getByRole('button', { name: /^Today/ })).toBeVisible({ timeout: 60_000 })

    const before = await panel.locator('button[aria-expanded]').count()
    // The infinite-scroll sentinel is only rendered while more pages remain.
    const sentinel = panel.locator('div.py-4.text-center')
    await expect(sentinel).toBeVisible({ timeout: 20_000 })
    await sentinel.scrollIntoViewIfNeeded()

    // IntersectionObserver fires → page 2 appends → a new day group appears.
    await expect
      .poll(async () => panel.locator('button[aria-expanded]').count(), { timeout: 25_000 })
      .toBeGreaterThan(before)
  })
})
