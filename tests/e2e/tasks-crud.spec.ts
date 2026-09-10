import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { applyAuthCookie } from '../support/helpers/auth'

// =============================================================================
// Story 4.1: Task CRUD with Templates & Assignment — E2E Spec
// =============================================================================
// Runs against the REAL dev stack (web :3000 + api :4000) with the seeded dev
// database. Covers the frontend acceptance criteria AC 63-83:
//   - routes /tasks, /tasks/new, /tasks/[id], /tasks/[id]/edit, /tasks/templates
//   - TasksTable list (columns, filters, pagination, "My tasks only", empty state)
//   - TaskDetailClient actions (Complete / Assign / Edit / Delete + badges)
//   - TaskForm create + edit (validation, pre-population, assignee picker)
//   - TaskTemplatesManager (list, create dialog, one-click create-from-template)
//   - AssigneePickerDialog
//
// Prerequisites (applied by this run):
//   - `pnpm dev` running (web :3000 + api :4000)
//   - The 20260802100000_add_task_and_task_template migration applied to the
//     dev DB (Task / TaskTemplate tables exist). The dev DB has no
//     _prisma_migrations history (db-push baseline), so `prisma migrate dev`
//     cannot run; the hand-written migration SQL is applied via
//     `prisma db execute --file`.
//
// Auth model (proven on 3-7): the browser sends a hand-signed JWT in the
// httpOnly `auth-token` cookie (middleware-verified, secret matches Infisical).
// Permission grants resolve server-side from DB role rows by userId. User ids
// are resolved at setup via POST /auth/login — the seed assigns random UUIDs,
// so hardcoding them breaks on every fresh DB (E2E-37 fix).
// =============================================================================

test.describe.configure({ retries: 1 })
test.use({ navigationTimeout: 60_000 })

const BACKEND_URL = 'http://127.0.0.1:4000/graphql'
const AUTH_LOGIN_URL = 'http://127.0.0.1:4000/auth/login'
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const DEMO_PASSWORD = 'Demo@123456'

// Resolved at runtime from /auth/login (seed assigns random UUIDs).
let ADMIN_USER = ''
let SALES_USER = ''
let adminToken = ''
let setupFailed = false
/** First seeded contact (for the create-flow contact picker); '' = none. */
let contactId = ''
let contactLabel = ''

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

const TASK_FIELDS = `
  id
  title
  description
  status
  priority
  dueDate
  assignedTo
  contactId
  dealId
  completedAt
  createdBy
  createdAt
  updatedAt
  assignee { id firstName lastName email }
  contact { id firstName lastName email }
  deal { id title }
`

/** Creates a task through the real API as admin. Returns { id, title }. */
async function createTaskViaApi(
  request: import('@playwright/test').APIRequestContext,
  overrides: {
    title: string
    description?: string
    status?: string
    priority?: string
    dueDate?: string
    assignedTo?: string
    contactId?: string
  },
): Promise<{ id: string; title: string }> {
  const created = await apiGraphql(
    request,
    adminToken,
    /* GraphQL */ `
      mutation CreateTask($input: CreateTaskInput!) {
        createTask(input: $input) { ${TASK_FIELDS} }
      }
    `,
    { input: overrides },
  )
  const task = created.body?.data?.createTask
  if (!task?.id) {
    throw new Error(`createTask failed: ${JSON.stringify(created.body)}`)
  }
  return { id: task.id as string, title: task.title as string }
}

/** Creates a template through the real API as admin. Returns the template. */
async function createTemplateViaApi(
  request: import('@playwright/test').APIRequestContext,
  overrides: { name: string; title: string; defaultPriority?: string; defaultDueInDays?: number },
): Promise<{ id: string; name: string; title: string }> {
  const created = await apiGraphql(
    request,
    adminToken,
    /* GraphQL */ `
      mutation CreateTaskTemplate($input: CreateTaskTemplateInput!) {
        createTaskTemplate(input: $input) {
          id
          name
          title
          defaultPriority
          defaultDueInDays
        }
      }
    `,
    { input: overrides },
  )
  const template = created.body?.data?.createTaskTemplate
  if (!template?.id) {
    throw new Error(`createTaskTemplate failed: ${JSON.stringify(created.body)}`)
  }
  return template as { id: string; name: string; title: string }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test.describe('Task CRUD with Templates & Assignment — Story 4.1', () => {
  test.beforeAll(async ({ request }) => {
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_TENANT_ID'] = TENANT_ID

    try {
      const admin = await apiLogin(request, 'admin@example.com')
      const sales = await apiLogin(request, 'sales@example.com')
      ADMIN_USER = admin.userId
      SALES_USER = sales.userId
      adminToken = admin.accessToken
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 4.1] Login unavailable for setup: ${msg}`)
      setupFailed = true
    }

    if (setupFailed) return

    try {
      const lookup = await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          query SetupLookup {
            contacts(pagination: { page: 1, pageSize: 1 }) {
              items {
                id
                firstName
                lastName
                email
              }
            }
          }
        `,
      )
      const contact = lookup.body?.data?.contacts?.items?.[0]
      if (contact) {
        contactId = contact.id as string
        contactLabel = `${contact.firstName} ${contact.lastName}`
      } else {
        console.warn('[E2E 4.1] No seeded contacts — contact picker steps will be skipped')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 4.1] API unavailable for setup lookup: ${msg}`)
      setupFailed = true
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

  // =====================================================================
  // AC 63 / AC 82 — Routes & app-shell navigation
  // =====================================================================
  test('[P1] E2E-T-01: Tasks nav item is visible and navigates to /tasks', async ({ page }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/dashboard')
    const navLink = page.getByRole('link', { name: 'Tasks', exact: true })
    await expect(navLink).toBeVisible({ timeout: 30_000 })
    await expect(navLink).toHaveAttribute('href', '/tasks')

    await navLink.click()
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible({
      timeout: 30_000,
    })
    // Breadcrumb segment label (AC 82 — Breadcrumbs SEGMENT_LABELS).
    await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Tasks', {
      timeout: 10_000,
    })
  })

  // =====================================================================
  // AC 66-70 — Tasks list page
  // =====================================================================
  test('[P1] E2E-T-02: Tasks list renders table columns, filters and header actions', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const { title } = await createTaskViaApi(request, {
      title: `E2E T-02 List ${suffix}`,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedTo: ADMIN_USER,
    })

    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible({
      timeout: 30_000,
    })

    // Search for the fresh task's unique title first — the list sorts by
    // dueDate (nulls last), so a due-date-less task can drift to page 2 as
    // other E2E runs accumulate due-dated rows in the shared dev DB.
    await page.getByRole('textbox', { name: 'Search tasks' }).fill(title)

    // The freshly created task renders in the table (title + assignee + badge).
    const row = page.locator('tr', { hasText: title }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row).toContainText('Acme Admin')
    await expect(row).toContainText('In progress')
    await expect(row).toContainText('High')

    // Semantic table headers (AC 67, AC 83 — <th> headers).
    for (const header of ['Title', 'Status', 'Priority', 'Assignee', 'Due date', 'Related']) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible()
    }

    // Filter bar controls (AC 68).
    await expect(page.getByRole('textbox', { name: 'Search tasks' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Filter by status' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Filter by priority' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'My tasks only' })).toBeVisible()

    // Header actions (AC 68 / AC 81 — "New from template" on the list page).
    await expect(page.getByRole('link', { name: 'New from template' })).toHaveAttribute(
      'href',
      '/tasks/new?fromTemplate=1',
    )
    await expect(page.getByRole('link', { name: 'Create task', exact: true })).toHaveAttribute(
      'href',
      '/tasks/new',
    )

    // Pagination footer renders the total count (AC 69).
    await expect(page.getByText(/tasks$/).first()).toBeVisible()
  })

  test('[P1] E2E-T-03: Tasks list shows empty state when no tasks match', async ({ page }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible({
      timeout: 30_000,
    })

    // Search for a title that cannot exist → empty state (AC 66).
    const search = page.getByRole('textbox', { name: 'Search tasks' })
    await search.fill(`zz-no-such-task-${uniqueSuffix()}`)
    await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByText('Create your first task to start tracking your work.'),
    ).toBeVisible()
  })

  // =====================================================================
  // AC 74-78 — Create form
  // =====================================================================
  test('[P1] E2E-T-04: Create form validates empty title', async ({ page }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/tasks/new')
    // CardTitle renders a <div>, not a heading role — match its text.
    await expect(page.getByText('Create task', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    })

    // All required fields present (AC 74-77).
    await expect(page.getByPlaceholder('Enter task title')).toBeVisible()
    await expect(page.getByPlaceholder('Enter task description')).toBeVisible()
    await expect(page.getByLabel('Status')).toBeVisible()
    await expect(page.getByLabel('Priority')).toBeVisible()
    await expect(page.getByLabel('Due date')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search assignee' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search contacts' })).toBeVisible()

    // Submit with empty title → inline validation error (AC 75).
    await page.getByRole('button', { name: 'Create task', exact: true }).click()
    await expect(page.getByText('Title is required', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    // Error connects via aria-describedby (AC 83).
    const titleInput = page.getByPlaceholder('Enter task title')
    await expect(titleInput).toHaveAttribute('aria-invalid', 'true')
    await expect(titleInput).toHaveAttribute('aria-describedby', 'task-title-error')
  })

  test('[P1] E2E-T-05: Create task via UI — redirects to detail with all badges', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const title = `E2E T-05 Create ${suffix}`

    await page.goto('/tasks/new')
    // CardTitle renders a <div>, not a heading role — match its text.
    await expect(page.getByText('Create task', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    })

    await page.getByPlaceholder('Enter task title').fill(title)
    await page.getByPlaceholder('Enter task description').fill('Created by E2E suite')
    await page.getByLabel('Status').selectOption('IN_PROGRESS')
    await page.getByLabel('Priority').selectOption('HIGH')
    await page.getByLabel('Due date').fill('2026-08-15')

    // Assignee picker: search + select the admin user (AC 78).
    const assigneeInput = page.getByRole('textbox', { name: 'Search assignee' })
    await assigneeInput.click()
    await assigneeInput.fill('admin@')
    const adminOption = page.getByRole('button', { name: /admin@example\.com/ }).first()
    await expect(adminOption).toBeVisible({ timeout: 15_000 })
    await adminOption.click()
    // Selected assignee is reflected in the search input.
    await expect(assigneeInput).toHaveValue(/Acme Admin/)

    // Contact picker (AC 77) — only when a seeded contact exists.
    if (contactId) {
      const contactInput = page.getByRole('textbox', { name: 'Search contacts' })
      await contactInput.click()
      await contactInput.fill(contactLabel.split(' ')[0])
      const contactOption = page.locator('button', { hasText: contactLabel }).first()
      await expect(contactOption).toBeVisible({ timeout: 15_000 })
      await contactOption.click()
    }

    await page.getByRole('button', { name: 'Create task', exact: true }).click()

    // Redirect to the detail page (AC 74 — router.push(`/tasks/${saved.id}`)).
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/, { timeout: 20_000 })

    // Record shown on detail (AC 71-72): title + badges + assigned-to line.
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('High', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Upcoming', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Assigned to Acme Admin/)).toBeVisible()

    // Detail actions present for an ADMIN actor (AC 72).
    await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Assign' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()
  })

  // =====================================================================
  // AC 71-72 — Detail page: badges, Complete, Delete
  // =====================================================================
  test('[P1] E2E-T-06: Detail page badges and Complete action', async ({ page, request }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const { id } = await createTaskViaApi(request, {
      title: `E2E T-06 Complete ${suffix}`,
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      dueDate: '2026-08-10',
      assignedTo: ADMIN_USER,
    })

    await page.goto(`/tasks/${id}`)
    await expect(
      page.getByRole('heading', { name: `E2E T-06 Complete ${suffix}`, level: 1 }),
    ).toBeVisible({
      timeout: 30_000,
    })

    // Badges pair colour with text (AC 70): status, priority, due-status.
    await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Urgent', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Upcoming', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Assigned to Acme Admin')).toBeVisible()

    // Back link (AC 71).
    await expect(page.getByRole('link', { name: 'Back to tasks' })).toBeVisible()

    // Complete → toast stating impact (AC 72) → status flips, button hides.
    await page.getByRole('button', { name: 'Complete' }).click()
    await expect(page.getByText('Task completed and removed from your open list')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('button', { name: 'Complete' })).not.toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Completed at').first()).toBeVisible({ timeout: 10_000 })
  })

  test('[P1] E2E-T-07: Delete action confirms, soft-deletes and returns to the list', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const title = `E2E T-07 Delete ${suffix}`
    const { id } = await createTaskViaApi(request, { title, assignedTo: ADMIN_USER })

    await page.goto(`/tasks/${id}`)
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({
      timeout: 30_000,
    })

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete' }).click()

    // Toast + redirect back to /tasks (AC 72).
    await expect(page.getByText('Task deleted', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.waitForURL(/\/tasks$/, { timeout: 20_000 })

    // Soft-deleted task no longer appears in the list (AC 36 backend behaviour).
    const search = page.getByRole('textbox', { name: 'Search tasks' })
    await search.fill(title)
    await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible({ timeout: 20_000 })
  })

  // =====================================================================
  // AC 74-76 — Edit flow
  // =====================================================================
  test('[P1] E2E-T-08: Edit page pre-populates and saves changes', async ({ page, request }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const original = `E2E T-08 Edit ${suffix}`
    const updated = `${original} [updated]`
    const { id } = await createTaskViaApi(request, {
      title: original,
      description: 'Original description',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueDate: '2026-08-15',
      assignedTo: ADMIN_USER,
    })

    await page.goto(`/tasks/${id}/edit`)
    // CardTitle renders a <div>, not a heading role — match its text.
    await expect(page.getByText('Edit task', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    })

    // Pre-populated from the server-rendered task (AC 74-76).
    await expect(page.getByPlaceholder('Enter task title')).toHaveValue(original)
    await expect(page.getByLabel('Status')).toHaveValue('IN_PROGRESS')
    await expect(page.getByLabel('Priority')).toHaveValue('HIGH')
    await expect(page.getByLabel('Due date')).toHaveValue('2026-08-15')

    // Change the title and save.
    await page.getByPlaceholder('Enter task title').fill(updated)
    await page.getByRole('button', { name: 'Update task' }).click()

    // Back on the detail page with the new title (AC 74 — router.push detail).
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: updated, level: 1 })).toBeVisible({
      timeout: 20_000,
    })
  })

  // =====================================================================
  // AC 72 / AC 78 — AssigneePickerDialog (Assign action)
  // =====================================================================
  test('[P1] E2E-T-09: Assign action reassigns via AssigneePickerDialog', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const { id } = await createTaskViaApi(request, {
      title: `E2E T-09 Assign ${suffix}`,
      assignedTo: ADMIN_USER,
    })

    await page.goto(`/tasks/${id}`)
    await expect(page.getByText(`E2E T-09 Assign ${suffix}`).first()).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText('Assigned to Acme Admin')).toBeVisible()

    await page.getByRole('button', { name: 'Assign' }).click()

    // Dialog opens with a user search (AC 78 — searchUsers).
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Assign task' })).toBeVisible()

    const search = dialog.getByRole('textbox', { name: 'Search users' })
    await search.fill('sales@')
    const salesOption = dialog.getByRole('button', { name: /sales@example\.com/ }).first()
    await expect(salesOption).toBeVisible({ timeout: 15_000 })
    await salesOption.click()

    // Toast + refreshed assignee line (AC 72 — Assign mutation).
    await expect(page.getByText('Task assigned', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(dialog).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Assigned to Acme Sales Rep')).toBeVisible({ timeout: 20_000 })
  })

  // =====================================================================
  // AC 79-81 — Templates manager
  // =====================================================================
  test('[P1] E2E-T-10: Templates page renders shell and empty state', async ({ page }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto('/tasks/templates')
    await expect(page.getByRole('heading', { name: 'Task templates', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText('Reusable patterns for creating tasks in one click.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add template' })).toBeVisible()
  })

  test('[P1] E2E-T-11: Create a template via the dialog and it appears in the table', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const name = `E2E Follow-up ${suffix}`
    const taskTitle = `Follow up with prospect ${suffix}`

    await page.goto('/tasks/templates')
    await expect(page.getByRole('heading', { name: 'Task templates', exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Add template' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Add task template' })).toBeVisible()

    // Fields (AC 79 — TaskTemplateForm). The form renders each <label> as a
    // sibling of its <input> inside a `div.space-y-1` wrapper, so target the
    // wrapper by its label text and descend to the control.
    const field = (labelText: string) =>
      dialog.locator('div.space-y-1', { hasText: labelText }).locator('input, select').first()
    await field('Name').fill(name)
    await field('Task title').fill(taskTitle)
    await field('Default priority').selectOption('URGENT')
    await field('Due in').fill('3')

    await dialog.getByRole('button', { name: 'Create', exact: true }).click()

    // Toast + dialog closes (AC 79-80 — invalidateQueries + handleClose reset).
    await expect(page.getByText('Task template created', { exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await expect(dialog).not.toBeVisible({ timeout: 10_000 })

    // New template row renders name / task title / priority / due-in (AC 79).
    const row = page.locator('tr', { hasText: name }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(taskTitle)
    await expect(row).toContainText('Urgent')
    await expect(row).toContainText('3 days')
  })

  test('[P1] E2E-T-12: One-click create task from template redirects to the new task', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const template = await createTemplateViaApi(request, {
      name: `E2E Onclick ${suffix}`,
      title: `Onclick task title ${suffix}`,
      defaultPriority: 'HIGH',
      defaultDueInDays: 5,
    })

    await page.goto('/tasks/templates')
    await expect(page.getByRole('heading', { name: 'Task templates', exact: true })).toBeVisible({
      timeout: 30_000,
    })

    // One-click action per row (AC 81 — createTaskFromTemplate(templateId, {})).
    const useButton = page.getByRole('button', { name: `Create task from ${template.name}` })
    await expect(useButton).toBeVisible({ timeout: 15_000 })
    await useButton.click()

    // Toast naming the resulting due date (AC 81) + redirect to the new task.
    await expect(page.getByText(/Task created from template/)).toBeVisible({ timeout: 15_000 })
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/, { timeout: 20_000 })

    // Detail shows the template's task title (and the stamped priority).
    await expect(page.getByRole('heading', { name: template.title, level: 1 })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('High', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Upcoming', { exact: true }).first()).toBeVisible()
  })

  // =====================================================================
  // AC 68 — "My tasks only" toggle (getTasks ↔ getMyTasks)
  // =====================================================================
  test('[P1] E2E-T-13: My tasks only toggle switches the list to myTasks', async ({
    page,
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    const suffix = uniqueSuffix()
    const mineTitle = `E2E Mine ${suffix}`
    const otherTitle = `E2E Other ${suffix}`
    // One task assigned to the acting admin, one assigned to sales.
    await createTaskViaApi(request, { title: mineTitle, assignedTo: ADMIN_USER })
    await createTaskViaApi(request, { title: otherTitle, assignedTo: SALES_USER })

    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible({
      timeout: 30_000,
    })
    const search = page.getByRole('textbox', { name: 'Search tasks' })
    const toggle = page.getByRole('checkbox', { name: 'My tasks only' })

    // Off (getTasks — admin has ALL visibility): both rows visible.
    await search.fill(mineTitle)
    await expect(page.locator('tr', { hasText: mineTitle })).toBeVisible({ timeout: 20_000 })
    await search.fill(otherTitle)
    await expect(page.locator('tr', { hasText: otherTitle })).toBeVisible({ timeout: 20_000 })

    // Flip the toggle while a row is still visible — TasksTable's early
    // EmptyState return unmounts the filter bar when the list is empty, so
    // the checkbox only exists while at least one row matches.
    await search.fill(mineTitle)
    await toggle.click()
    await expect(toggle).toBeChecked()

    // On (getMyTasks — only the caller's assignments): the sales-assigned
    // task disappears even though admin sees it via the unfiltered query.
    await search.fill(otherTitle)
    await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible({ timeout: 20_000 })
  })
})
