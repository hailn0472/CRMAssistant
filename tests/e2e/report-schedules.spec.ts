import { expect, test } from '@playwright/test'

import { applyAuthCookie } from '../support/helpers/auth'

// ===========================================================================
// Story 6.5 — Scheduled Report Delivery via Email (AC 7, 8, 16) — E2E
//
// APPROACH: route-mocked GraphQL, the same house pattern as
// tests/e2e/custom-report-builder.spec.ts (§22b/§22c of the playwright-e2e
// skill). Every client-side GraphQL call is fulfilled in-browser via
// page.route('**/api/graphql'), so the web app runs standalone — the spec
// needs NO API backend, NO database and NO SMTP credentials. SMTP email
// delivery is deliberately out of scope here: it is covered by the API
// integration suite (report-schedule-email.integration.spec.ts) with an
// injected fake transport. Keeping E2E mocked makes it deterministic and
// independent of external services.
//
// Coverage map (binding ACs):
//   AC 7  — Schedule button on a saved report surface (enabled/disabled) and
//           opening the shared ScheduleReportDialog.
//   AC 8  — Schedule modal: frequency (5 options), day/time, recipients
//           (email), format (PDF/EXCEL/CSV), next-run preview + validation.
//   AC 16 — /reports/schedules lists all scheduled reports with next run time,
//           plus Edit / Pause / Resume / Delete row actions.
//
// The Schedule button also exists on the saved sales-report surface
// (SalesReportsWorkspace.tsx) — that wiring is asserted in RTL
// (SalesReportsWorkspace.spec.tsx). E2E exercises the saved custom-report
// surface (CustomReportBuilder edit mode) because it is the lighter, already
// proven path and both surfaces open the exact same dialog.
//
// AUTH: applyAuthCookie() signs a fake JWT with process.env['JWT_SECRET'].
// The web middleware verifies the same secret. When the server is the
// Infisical-wrapped `pnpm --filter=web dev`, the Infisical secret is used
// (the constant below). When running self-contained (CI / no backend),
// override API_JWT_SECRET to the same dummy secret the server boots with
// (see playwright-e2e skill §29). Same precedent as contact-timeline and
// custom-report-builder.
// ===========================================================================

const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'

// ---------------------------------------------------------------------------
// Types (mirror apps/web/src/services/report-schedule.service.ts)
// ---------------------------------------------------------------------------

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'CUSTOM_CRON'
type Format = 'PDF' | 'EXCEL' | 'CSV'

type MockSchedule = {
  id: string
  reportId: string
  report: { id: string; name: string; type: string }
  frequency: Frequency
  recipients: string[]
  format: Format
  timezone: string
  scheduledTime: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  startMonth: number | null
  cronExpression: string | null
  nextRunAt: string
  lastRunAt: string | null
  isActive: boolean
  lastExecution: {
    id: string
    status: 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'
    scheduledFor: string
    attemptCount: number
    nextRetryAt: string | null
    completedAt: string | null
    errorCode: string | null
    errorMessage: string | null
    createdAt: string
  } | null
  createdAt: string
  updatedAt: string
}

type MockHandler = (postData: { query: string; variables?: Record<string, unknown> }) =>
  | { data?: unknown; errors?: Array<{ message: string }> }
  | Promise<{
      data?: unknown
      errors?: Array<{ message: string }>
    }>

async function setupGraphqlMock(
  page: import('@playwright/test').Page,
  handlers: Array<[string, MockHandler]>,
): Promise<void> {
  await page.route('**/api/graphql', async (route) => {
    const postData = route.request().postDataJSON()
    if (!postData?.query) {
      await route.continue()
      return
    }
    for (const [matcher, handler] of handlers) {
      if (postData.query.includes(matcher)) {
        const result = await handler(postData)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(result),
        })
        return
      }
    }
    await route.continue()
  })
}

function makeSchedule(idx: number, overrides: Partial<MockSchedule> = {}): MockSchedule {
  return {
    id: `sched-${idx}`,
    reportId: 'sales-1',
    report: { id: 'sales-1', name: `Sales Report ${idx}`, type: 'SALES_OVERVIEW' },
    frequency: 'DAILY',
    recipients: [`user${idx}@example.com`],
    format: 'PDF',
    timezone: 'UTC',
    scheduledTime: '08:00',
    dayOfWeek: null,
    dayOfMonth: null,
    startMonth: null,
    cronExpression: null,
    nextRunAt: '2026-08-19T08:00:00.000Z',
    lastRunAt: null,
    isActive: true,
    lastExecution: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  }
}

function fullPermissions(): Array<{ resource: string; action: string; granted: boolean }> {
  return ['REPORT', 'DEAL', 'CONTACT', 'TASK'].flatMap((resource) =>
    ['READ', 'CREATE', 'UPDATE', 'DELETE'].map((action) => ({ resource, action, granted: true })),
  )
}

type ScheduleMockState = {
  schedules: MockSchedule[]
  permissions?: Array<{ resource: string; action: string; granted: boolean }>
  reportName?: string
  reportType?: string
  listError?: boolean
}

/**
 * Route handlers for the schedule CRUD surface: MyPermissions, the
 * ReportSchedules list query, and all five schedule mutations. A stateful
 * closure is the single source of truth — mutations write it, the list query
 * reads it (one-writer-per-field rule from the playwright-e2e skill §22b).
 */
function scheduleHandlers(state: ScheduleMockState): Array<[string, MockHandler]> {
  const permissions = state.permissions ?? fullPermissions()
  return [
    ['query MyPermissions', () => ({ data: { myPermissions: permissions } })],
    [
      'query ReportSchedules',
      () => {
        if (state.listError) {
          return { errors: [{ message: 'Failed to fetch schedules' }] }
        }
        return {
          data: {
            reportSchedules: {
              items: state.schedules,
              total: state.schedules.length,
              page: 1,
              pageSize: 20,
            },
          },
        }
      },
    ],
    [
      'mutation ScheduleReport',
      (postData) => {
        const input = (postData.variables?.['input'] ?? {}) as Record<string, unknown>
        const schedule = makeSchedule(state.schedules.length + 1, {
          id: `sched-${state.schedules.length + 1}`,
          reportId: String(input['reportId'] ?? ''),
          report: {
            id: String(input['reportId'] ?? ''),
            name: state.reportName ?? 'Saved Report',
            type: state.reportType ?? 'REPORT',
          },
          frequency: input['frequency'] as Frequency,
          recipients: [...((input['recipients'] as string[]) ?? [])],
          format: input['format'] as Format,
          timezone: String(input['timezone'] ?? 'UTC'),
          scheduledTime: String(input['scheduledTime'] ?? '08:00'),
          dayOfWeek: (input['dayOfWeek'] as number | null) ?? null,
          dayOfMonth: (input['dayOfMonth'] as number | null) ?? null,
          startMonth: (input['startMonth'] as number | null) ?? null,
          cronExpression: (input['cronExpression'] as string | null) ?? null,
          nextRunAt: '2026-08-22T09:30:00.000Z',
        })
        state.schedules.push(schedule)
        return { data: { scheduleReport: schedule } }
      },
    ],
    [
      'mutation UpdateSchedule',
      (postData) => {
        const id = String(postData.variables?.['id'])
        const input = (postData.variables?.['input'] ?? {}) as Record<string, unknown>
        const schedule = state.schedules.find((s) => s.id === id)
        if (!schedule)
          return { data: { updateSchedule: null }, errors: [{ message: 'Schedule not found' }] }
        if (input['frequency'] !== undefined) schedule.frequency = input['frequency'] as Frequency
        if (input['recipients'] !== undefined)
          schedule.recipients = [...((input['recipients'] as string[]) ?? [])]
        if (input['format'] !== undefined) schedule.format = input['format'] as Format
        if (input['timezone'] !== undefined) schedule.timezone = String(input['timezone'])
        if (input['scheduledTime'] !== undefined)
          schedule.scheduledTime = String(input['scheduledTime'])
        schedule.dayOfWeek = (input['dayOfWeek'] as number | null) ?? schedule.dayOfWeek
        schedule.dayOfMonth = (input['dayOfMonth'] as number | null) ?? schedule.dayOfMonth
        schedule.startMonth = (input['startMonth'] as number | null) ?? schedule.startMonth
        schedule.cronExpression =
          (input['cronExpression'] as string | null) ?? schedule.cronExpression
        return { data: { updateSchedule: schedule } }
      },
    ],
    [
      'mutation PauseSchedule',
      (postData) => {
        const id = String(postData.variables?.['id'])
        const schedule = state.schedules.find((s) => s.id === id)
        if (schedule) schedule.isActive = false
        return { data: { pauseSchedule: schedule } }
      },
    ],
    [
      'mutation ResumeSchedule',
      (postData) => {
        const id = String(postData.variables?.['id'])
        const schedule = state.schedules.find((s) => s.id === id)
        if (schedule) schedule.isActive = true
        return { data: { resumeSchedule: schedule } }
      },
    ],
    [
      'mutation DeleteSchedule',
      (postData) => {
        const id = String(postData.variables?.['id'])
        state.schedules = state.schedules.filter((s) => s.id !== id)
        return { data: { deleteSchedule: true } }
      },
    ],
  ]
}

// ---------------------------------------------------------------------------
// CustomReportBuilder edit-mode mocks (AC 7 surface). A minimal saved DEALS
// config is loaded back so the Schedule button renders enabled. Dimensions and
// metrics are empty so no preview query fires — the header + dialog are all
// this spec needs from the builder.
// ---------------------------------------------------------------------------

const DEALS_CATALOG = {
  dataSource: 'DEALS',
  fields: [
    {
      key: 'deal.createdAt',
      label: 'Created at',
      valueType: 'DATETIME',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: ['ON', 'BEFORE', 'AFTER'],
      relationKind: null,
      isNumeric: false,
      isCurrency: false,
      isDate: true,
    },
    {
      key: 'deal.stage',
      label: 'Stage',
      valueType: 'RELATION',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: ['EQ', 'NOT_EQ', 'IN'],
      relationKind: 'STAGE',
      isNumeric: false,
      isCurrency: false,
      isDate: false,
    },
    {
      key: 'deal.value',
      label: 'Value',
      valueType: 'NUMBER',
      roles: ['FILTER', 'DIMENSION', 'METRIC'],
      aggregations: ['COUNT', 'DISTINCT_COUNT', 'SUM', 'AVERAGE', 'MIN', 'MAX'],
      filterOperators: ['EQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN'],
      relationKind: null,
      isNumeric: true,
      isCurrency: true,
      isDate: false,
    },
  ],
}

const SAVED_CUSTOM_CONFIG = {
  version: 2,
  dataSource: 'DEALS',
  filters: [],
  dimensions: [],
  metrics: [],
  calculatedFields: [],
  visualization: { type: 'BAR', title: 'Revenue by stage' },
  sort: [],
}

/** Mocks only the builder's data queries (NOT MyPermissions — that is shared
 *  with the schedule surface and lives in scheduleHandlers()). */
function builderDataHandlers(): Array<[string, MockHandler]> {
  return [
    [
      'query CustomReportData',
      () => ({
        data: {
          customReportData: {
            reportId: 'custom-report-1',
            generatedAt: '2026-08-16T12:00:00.000Z',
            config: SAVED_CUSTOM_CONFIG,
            columns: [],
            rows: [],
            totalRows: 0,
            series: [],
            warnings: [],
            pagination: { page: 1, pageSize: 50, totalPages: 1 },
            truncated: false,
          },
        },
      }),
    ],
    [
      'query CustomReportFieldCatalog',
      () => ({ data: { customReportFieldCatalog: DEALS_CATALOG } }),
    ],
  ]
}

test.beforeEach(async ({ context }) => {
  // Sign the auth cookie with the secret the web server actually accepts.
  process.env['JWT_SECRET'] = API_JWT_SECRET
  await applyAuthCookie(context)
})

test.afterEach(() => {
  // Unset to avoid leaking the secret to other specs in this worker.
  delete process.env['JWT_SECRET']
})

// ---------------------------------------------------------------------------
// AC 16 — /reports/schedules page
// ---------------------------------------------------------------------------

test.describe('/reports/schedules page (AC 16)', () => {
  test('renders the empty state when no schedules exist', async ({ page }) => {
    await setupGraphqlMock(page, scheduleHandlers({ schedules: [] }))
    await page.goto('/reports/schedules', { timeout: 120_000 })

    await expect(page.getByRole('heading', { name: 'Scheduled Reports' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText('No scheduled report deliveries yet')).toBeVisible()
  })

  test('lists schedules with name, frequency, recipients, format and next run time', async ({
    page,
  }) => {
    const schedules: MockSchedule[] = [
      makeSchedule(1, {
        report: { id: 'sales-1', name: 'August Overview', type: 'SALES_OVERVIEW' },
        frequency: 'DAILY',
        recipients: ['alice@example.com', 'bob@example.com'],
        format: 'PDF',
        timezone: 'UTC',
        scheduledTime: '08:00',
        nextRunAt: '2026-08-19T08:00:00.000Z',
      }),
      makeSchedule(2, {
        report: { id: 'custom-report-1', name: 'Revenue by stage', type: 'CUSTOM' },
        frequency: 'WEEKLY',
        dayOfWeek: 1,
        recipients: ['carol@example.com'],
        format: 'EXCEL',
        timezone: 'UTC',
        scheduledTime: '09:00',
        lastRunAt: '2026-08-12T09:00:00.000Z',
        lastExecution: {
          id: 'exec-1',
          status: 'SUCCESS',
          scheduledFor: '2026-08-12T09:00:00.000Z',
          attemptCount: 1,
          nextRetryAt: null,
          completedAt: '2026-08-12T09:00:05.000Z',
          errorCode: null,
          errorMessage: null,
          createdAt: '2026-08-12T09:00:00.000Z',
        },
      }),
    ]
    await setupGraphqlMock(page, scheduleHandlers({ schedules }))
    await page.goto('/reports/schedules', { timeout: 120_000 })

    // Row 1 — active daily PDF with two recipients.
    await expect(page.getByRole('link', { name: 'August Overview' })).toBeVisible()
    await expect(page.getByText('Daily at 08:00 (UTC)')).toBeVisible()
    await expect(page.getByText('2 recipients')).toBeVisible()
    await expect(page.getByText('PDF', { exact: true })).toBeVisible()
    const nextRun = page.getByRole('time')
    await expect(nextRun.first()).toHaveAttribute('dateTime', '2026-08-19T08:00:00.000Z')

    // Row 2 — weekly custom report with a SUCCESS last-run status.
    await expect(page.getByRole('link', { name: 'Revenue by stage' })).toBeVisible()
    await expect(page.getByText('Weekly on Monday at 09:00 (UTC)')).toBeVisible()
    await expect(page.getByText('EXCEL', { exact: true })).toBeVisible()
    await expect(page.getByText('SUCCESS', { exact: true })).toBeVisible()
  })

  test('shows a paused schedule with no next-run countdown', async ({ page }) => {
    const schedules: MockSchedule[] = [
      makeSchedule(1, { isActive: false, timezone: 'UTC', scheduledTime: '07:00' }),
    ]
    await setupGraphqlMock(page, scheduleHandlers({ schedules }))
    await page.goto('/reports/schedules', { timeout: 120_000 })

    await expect(page.getByText('— (Paused)')).toBeVisible()
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  test('list fetch failure shows the error state', async ({ page }) => {
    await setupGraphqlMock(page, scheduleHandlers({ schedules: [], listError: true }))
    await page.goto('/reports/schedules', { timeout: 120_000 })

    // TanStack Query retries the failed list query (3 attempts, exponential
    // backoff) before surfacing isError — give the assertion enough headroom.
    await expect(page.getByText('Failed to fetch schedules').first()).toBeVisible({
      timeout: 20_000,
    })
  })

  test('permission gating: users without REPORT:READ see the limited state', async ({ page }) => {
    await setupGraphqlMock(
      page,
      scheduleHandlers({
        schedules: [],
        permissions: [{ resource: 'DEAL', action: 'READ', granted: true }],
      }),
    )
    await page.goto('/reports/schedules', { timeout: 120_000 })

    await expect(
      page.getByText('You do not have permission to view report schedules.'),
    ).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// AC 7 — Schedule button on a saved report surface
// ---------------------------------------------------------------------------

test.describe('Schedule button on the saved custom report surface (AC 7)', () => {
  test('is disabled for an unsaved custom report draft', async ({ page }) => {
    await setupGraphqlMock(page, scheduleHandlers({ schedules: [] }))
    await page.goto('/reports/builder', { timeout: 120_000 })

    const scheduleButton = page.getByRole('button', { name: 'Schedule report delivery' })
    await expect(scheduleButton).toBeVisible({ timeout: 60_000 })
    await expect(scheduleButton).toBeDisabled()
  })

  test('is enabled for a saved report and opens the shared schedule dialog', async ({ page }) => {
    await setupGraphqlMock(page, [...scheduleHandlers({ schedules: [] }), ...builderDataHandlers()])
    await page.goto('/reports/builder?reportId=custom-report-1', { timeout: 120_000 })

    const scheduleButton = page.getByRole('button', { name: 'Schedule report delivery' })
    await expect(scheduleButton).toBeVisible({ timeout: 60_000 })
    await expect(scheduleButton).toBeEnabled()

    await scheduleButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Schedule Report Delivery' })).toBeVisible()
    // The report name also appears in the builder's own title (h3) behind the
    // dialog — scope to the dialog's "Selected Report" strip.
    await expect(page.getByRole('dialog').getByText('Revenue by stage')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// AC 8 — Schedule modal: create flow, format, recipients, next-run preview,
// validation
// ---------------------------------------------------------------------------

test.describe('Schedule creation flow (AC 8)', () => {
  test('creates a weekly schedule and it appears on /reports/schedules', async ({ page }) => {
    const state: ScheduleMockState = {
      schedules: [],
      reportName: 'Revenue by stage',
      reportType: 'CUSTOM',
    }
    await setupGraphqlMock(page, [...scheduleHandlers(state), ...builderDataHandlers()])

    // Open the create dialog from the saved custom report surface.
    await page.goto('/reports/builder?reportId=custom-report-1', { timeout: 120_000 })
    await page.getByRole('button', { name: 'Schedule report delivery' }).click()
    await expect(page.getByRole('heading', { name: 'Schedule Report Delivery' })).toBeVisible()

    // Recipients (email addresses).
    const recipientInput = page.getByPlaceholder(/Enter email address/)
    await recipientInput.fill('alice@example.com')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await recipientInput.fill('bob@example.com')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('alice@example.com')).toBeVisible()
    await expect(page.getByText('bob@example.com')).toBeVisible()

    // Delivery time + timezone. The builder's own viz panel contributes
    // "Legend position"/"Orientation" selects behind the modal — scope the
    // timezone select to the dialog (the only select it renders in DAILY mode).
    await page.locator('input[type="time"]').fill('09:30')
    await page.getByRole('dialog').locator('select').selectOption('UTC')

    // Frequency → WEEKLY + day of week.
    await page.getByRole('button', { name: 'Weekly', exact: true }).click()
    await page.getByRole('button', { name: 'Fri', exact: true }).click()

    // Format → EXCEL.
    await page.getByText('Excel (.xlsx)').click()

    // Next-run preview is rendered (AC 8 next-run preview).
    await expect(page.getByText(/Next Scheduled Occurrence Preview/)).toBeVisible()

    // Submit.
    await page.getByRole('button', { name: 'Create Schedule' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })

    // The created schedule is visible on the management page.
    await page.goto('/reports/schedules', { timeout: 120_000 })
    await expect(page.getByRole('link', { name: 'Revenue by stage' })).toBeVisible()
    await expect(page.getByText('Weekly on Friday at 09:30 (UTC)')).toBeVisible()
    await expect(page.getByText('2 recipients')).toBeVisible()
    await expect(page.getByText('EXCEL', { exact: true })).toBeVisible()
  })

  test('rejects an invalid recipient email with inline validation', async ({ page }) => {
    await setupGraphqlMock(page, [...scheduleHandlers({ schedules: [] }), ...builderDataHandlers()])
    await page.goto('/reports/builder?reportId=custom-report-1', { timeout: 120_000 })
    await page.getByRole('button', { name: 'Schedule report delivery' }).click()

    await page.getByPlaceholder(/Enter email address/).fill('not-an-email')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(page.getByText('Please enter a valid email address.')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// AC 16 — Edit / Pause / Resume / Delete row actions
// ---------------------------------------------------------------------------

test.describe('Schedule row actions (AC 16)', () => {
  test('edit opens pre-populated and updates the frequency', async ({ page }) => {
    const state: ScheduleMockState = {
      schedules: [
        makeSchedule(1, {
          report: { id: 'sales-1', name: 'Monthly Pipeline', type: 'SALES_OVERVIEW' },
          frequency: 'DAILY',
          recipients: ['a@x.com'],
          format: 'PDF',
          timezone: 'UTC',
          scheduledTime: '08:00',
        }),
      ],
    }
    await setupGraphqlMock(page, scheduleHandlers(state))
    await page.goto('/reports/schedules', { timeout: 120_000 })

    await page.getByRole('button', { name: /Edit Monthly Pipeline schedule/ }).click()
    await expect(page.getByRole('heading', { name: 'Edit Report Schedule' })).toBeVisible()

    // Pre-populated: DAILY pill selected, time + recipient carried over.
    await expect(page.getByRole('button', { name: 'Daily', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('input[type="time"]')).toHaveValue('08:00')
    await expect(page.getByText('a@x.com')).toBeVisible()

    // Change to MONTHLY, pick day 15.
    await page.getByRole('button', { name: 'Monthly', exact: true }).click()
    await page.locator('select').filter({ hasText: 'First day' }).selectOption('15')

    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText('Monthly on day 15 at 08:00 (UTC)')).toBeVisible()
  })

  test('pause deactivates the schedule and resume reactivates it', async ({ page }) => {
    const state: ScheduleMockState = {
      schedules: [
        makeSchedule(1, {
          report: { id: 'sales-1', name: 'August Overview', type: 'SALES_OVERVIEW' },
          timezone: 'UTC',
        }),
      ],
    }
    await setupGraphqlMock(page, scheduleHandlers(state))
    await page.goto('/reports/schedules', { timeout: 120_000 })

    const toggle = page.getByRole('switch')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    // Pause.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 })
    await expect(page.getByText('— (Paused)')).toBeVisible()

    // Resume.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 })
    await expect(page.getByText('— (Paused)')).not.toBeVisible()
  })

  test('delete removes the schedule after confirmation', async ({ page }) => {
    const state: ScheduleMockState = {
      schedules: [
        makeSchedule(1, {
          report: { id: 'sales-1', name: 'August Overview', type: 'SALES_OVERVIEW' },
        }),
      ],
    }
    await setupGraphqlMock(page, scheduleHandlers(state))
    await page.goto('/reports/schedules', { timeout: 120_000 })

    await page.getByRole('button', { name: /Delete August Overview schedule/ }).click()
    await expect(page.getByRole('heading', { name: 'Delete Report Schedule' })).toBeVisible()
    await expect(page.getByText(/Automated deliveries will cease/)).toBeVisible()

    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('No scheduled report deliveries yet')).toBeVisible({
      timeout: 10_000,
    })
  })

  test('requires at least one recipient before saving (missing required field)', async ({
    page,
  }) => {
    const state: ScheduleMockState = {
      schedules: [
        makeSchedule(1, {
          report: { id: 'sales-1', name: 'August Overview', type: 'SALES_OVERVIEW' },
          recipients: ['a@x.com'],
        }),
      ],
    }
    await setupGraphqlMock(page, scheduleHandlers(state))
    await page.goto('/reports/schedules', { timeout: 120_000 })

    await page.getByRole('button', { name: /Edit August Overview schedule/ }).click()
    // Remove the only recipient.
    await page.getByRole('button', { name: 'Remove a@x.com' }).click()

    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('At least one recipient email is required')).toBeVisible()
    // Dialog stays open — the mutation never fired.
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
