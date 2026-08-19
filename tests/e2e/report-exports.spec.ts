import { expect, test } from '@playwright/test'

import { applyAuthCookie } from '../support/helpers/auth'

// ===========================================================================
// Story 6.6 — Report Export in Multiple Formats (PDF, Excel, CSV) — E2E
//
// APPROACH: fully self-contained, CI-safe, deterministic. Every client-side
// GraphQL call is fulfilled in-browser via page.route('**/api/graphql') and
// the signed-download URL is a mocked cross-origin host
// (https://mock-signed-url.example/...) whose response is also fulfilled via
// page.route, so the suite needs NO API backend, NO database, NO Supabase
// service-role secret and NO real storage (contract F42). The web app runs
// standalone (`pnpm --filter=web dev:ci` with a dummy JWT secret, exactly
// like CI e2e.yml — see playwright-e2e skill §29).
//
// Binding AC coverage map (see test plan docs/workflow-artifacts/6-6-.../
// test-design/test-plan.md for the full matrix):
//   AC 3/4  — exportReport mutation shapes/format vocabulary exercised through
//             the real UI (backend SDL/registration proven at api tier).
//   AC 8    — PENDING/PROCESSING "queued" feedback + progress badges. Durable
//             claim/lease/worker transitions are PostgreSQL-backed and proven
//             at integration tier (report-exports.integration.spec.ts) — NOT
//             browser-deterministic, mapped there.
//   AC 9    — ?download=<id> ready deep link: single signed-URL mint, single
//             download, param cleared, no loop; FAILED/missing actionable
//             errors. Notification row/dedupe proven at integration tier.
//   AC 10   — fresh signed URL per click asserted E2E (mock URL minted per
//             call). Real private-bucket upload, tenant-first path and
//             86,400 s TTL are proven at unit/integration tiers with a fake
//             Storage adapter — NOT browser-testable, mapped there.
//   AC 11   — Export dropdown on saved sales + saved custom surfaces; exact
//             PDF/Excel (XLSX)/CSV options; keyboard open/close/focus;
//             disabled unsaved-draft state; filters forwarded.
//   AC 12   — sanitized server filename asserted as the real download
//             suggestedFilename. Deterministic filename derivation proven at
//             unit tier (report-export-filename.spec.ts).
//   AC 15   — FAILED history rows render the actionable 50 MB warning;
//             download/delete blocked on non-READY. The 50 MB renderer
//             overflow itself is proven at unit + integration tiers.
//   AC 16   — /reports/exports history: report/format/filter/date/status/
//             size/time columns, newest-first, pagination, re-download with a
//             FRESH URL each click, delete confirmation + list invalidation.
//   AC 17/18 — unit/artifact/integration mandates — not browser-tier,
//             mapped to those suites (report-export-artifacts.spec.ts etc.).
//
// NOT browser-testable (explicitly mapped to existing API suites in comments
// below): PDF/XLSX/CSV binary validity (artifact tier), background worker /
// lease / retry / stale recovery (integration tier), private bucket / object
// path / TTL / upsert:false (storage unit + integration with fake adapter),
// tenant isolation / owner-only negatives / ADMIN no-bypass (integration
// tier S1-S3), audit rows, notification dedupe.
//
// AUTH: applyAuthCookie() signs a fake JWT with process.env['JWT_SECRET'].
// When the server is booted self-contained with
// `JWT_SECRET=playwright-test-secret-min-32-chars!! pnpm --filter=web dev:ci`,
// set API_JWT_SECRET to the same dummy value (skill §29) so the cookie the
// web middleware verifies matches the signing secret.
// ===========================================================================

const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'

// Signed-URL mock host — never touches a real bucket.
const SIGNED_URL_ORIGIN = 'https://mock-signed-url.example'

// ---------------------------------------------------------------------------
// Types (mirror apps/web/src/services/report-export.service.ts + sales)
// ---------------------------------------------------------------------------

type Format = 'PDF' | 'EXCEL' | 'CSV'
type ExportStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'

type MockReportExport = {
  id: string
  status: ExportStatus
  format: Format
  filterSummary: string
  dateRangeStart: string | null
  dateRangeEnd: string | null
  filename: string | null
  contentType: string | null
  fileSizeBytes: number | null
  attemptCount: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  report: { id: string; name: string; type: string } | null
}

type MockReportRow = {
  id: string
  name: string
  type: string
  isSupported: boolean
  isPublic: boolean
  createdAt: string
  updatedAt: string
  createdBy: string
  config: Record<string, unknown> | null
}

type MockHandler = (postData: {
  query: string
  variables?: Record<string, unknown>
}) =>
  | { data?: unknown; errors?: Array<{ message: string }> }
  | Promise<{ data?: unknown; errors?: Array<{ message: string }> }>

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

function fullPermissions(): Array<{ resource: string; action: string; granted: boolean }> {
  return ['REPORT', 'DEAL', 'CONTACT', 'TASK', 'ACCOUNT'].flatMap((resource) =>
    ['READ', 'CREATE', 'UPDATE', 'DELETE'].map((action) => ({
      resource,
      action,
      granted: true,
    })),
  )
}

/** Grants REPORT:READ but nothing else (permission-denied states). */
function reportReadOnlyPermissions(): Array<{
  resource: string
  action: string
  granted: boolean
}> {
  return [{ resource: 'REPORT', action: 'READ', granted: true }]
}

function noReportPermissions(): Array<{ resource: string; action: string; granted: boolean }> {
  return [{ resource: 'DEAL', action: 'READ', granted: true }]
}

// ---------------------------------------------------------------------------
// Export fixtures
// ---------------------------------------------------------------------------

function makeExport(idx: number, overrides: Partial<MockReportExport> = {}): MockReportExport {
  const statuses: ExportStatus[] = ['READY', 'PENDING', 'PROCESSING', 'FAILED']
  const formats: Format[] = ['PDF', 'EXCEL', 'CSV']
  const status = overrides.status ?? statuses[idx % statuses.length]
  const format = overrides.format ?? formats[idx % formats.length]
  const ext = format === 'EXCEL' ? 'xlsx' : format.toLowerCase()
  const now = Date.now()
  return {
    id: `exp-${idx}`,
    status,
    format,
    filterSummary: 'All deals · datePreset THIS_MONTH',
    dateRangeStart: '2026-05-01T00:00:00.000Z',
    dateRangeEnd: '2026-05-31T00:00:00.000Z',
    filename:
      status === 'READY'
        ? `sales-report-${idx}_2026-05-01_to_2026-05-31_owner-a1b2c3d4.${ext}`
        : null,
    contentType: status === 'READY' ? 'application/pdf' : null,
    fileSizeBytes: status === 'READY' ? 2621440 : null,
    attemptCount: status === 'FAILED' ? 4 : 1,
    errorCode: status === 'FAILED' ? 'FILE_TOO_LARGE' : null,
    errorMessage:
      status === 'FAILED'
        ? 'Export exceeds the 50 MB limit. Narrow your date range or filters.'
        : null,
    createdAt: new Date(now - idx * 86_400_000).toISOString(),
    completedAt: status === 'READY' ? new Date(now - idx * 86_400_000 + 5_000).toISOString() : null,
    report: { id: 'sales-1', name: `Sales Report ${idx}`, type: 'SALES_OVERVIEW' },
    ...overrides,
  }
}

/** The exact server-sanitized filename shape (contract C15 / AC 12). */
const READY_FILENAME = 'sales-report_2026-05-01_to_2026-05-31_owner-a1b2c3d4.pdf'

function makeReadyExport(
  id = 'exp-ready-1',
  overrides: Partial<MockReportExport> = {},
): MockReportExport {
  return {
    id,
    status: 'READY',
    format: 'PDF',
    filterSummary: 'All deals · datePreset THIS_MONTH',
    dateRangeStart: '2026-05-01T00:00:00.000Z',
    dateRangeEnd: '2026-05-31T00:00:00.000Z',
    filename: READY_FILENAME,
    contentType: 'application/pdf',
    fileSizeBytes: 2621440,
    attemptCount: 1,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-08-15T12:00:00.000Z',
    completedAt: '2026-08-15T12:00:05.000Z',
    report: { id: 'sales-1', name: 'August Overview', type: 'SALES_OVERVIEW' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Shared stateful mock for the whole export surface (one writer per field —
// skill §22b). Mutations write the closure; queries read it.
// ---------------------------------------------------------------------------

type ExportMockState = {
  /** All history rows, newest first (list handler slices by page). */
  all: MockReportExport[]
  permissions?: Array<{ resource: string; action: string; granted: boolean }>
  listError?: boolean
  /** Error the list query for the first N calls (TanStack retries 3x). */
  listErrorForFirst?: number
  listDelayMs?: number
  /** Detail (off-page) item returned by `query ReportExport`. */
  detail?: MockReportExport
  detailError?: boolean
  /** Result of `mutation ExportReport` — test-controlled status. */
  exportStatus?: ExportStatus
  exportFilename?: string
  exportErrorCode?: string
  exportErrorMessage?: string
  /** If set, the export mutation waits on this gate before responding. */
  exportGate?: Promise<void>
  /** Queue of signed URLs returned by `reportExportDownloadUrl`. */
  downloadUrls?: string[]
  downloadUrlError?: boolean
  deleteError?: boolean
}

function buildExportHandlers(state: ExportMockState): {
  handlers: Array<[string, MockHandler]>
  counters: {
    exportMutation: number
    downloadUrl: number
    signedUrlFetch: number
    detailQuery: number
    deleteMutation: number
    list: number
  }
  lastVariables: {
    exportReport?: Record<string, unknown>
    downloadUrl?: Record<string, unknown>
    deleteExport?: Record<string, unknown>
  }
} {
  const counters = {
    exportMutation: 0,
    downloadUrl: 0,
    signedUrlFetch: 0,
    detailQuery: 0,
    deleteMutation: 0,
    list: 0,
  }
  const lastVariables = {
    exportReport: undefined as Record<string, unknown> | undefined,
    downloadUrl: undefined as Record<string, unknown> | undefined,
    deleteExport: undefined as Record<string, unknown> | undefined,
  }

  const handlers: Array<[string, MockHandler]> = [
    [
      'query MyPermissions',
      () => ({ data: { myPermissions: state.permissions ?? fullPermissions() } }),
    ],
    [
      // Plural matcher MUST be registered before the singular one below —
      // 'query ReportExports' contains the substring 'query ReportExport'.
      'query ReportExports',
      async (postData) => {
        counters.list++
        if (
          state.listError ||
          (state.listErrorForFirst !== undefined && counters.list <= state.listErrorForFirst)
        ) {
          return { errors: [{ message: 'Failed to fetch export history' }] }
        }
        if (state.listDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, state.listDelayMs))
        }
        const pagination = (postData.variables?.['pagination'] ?? {}) as Record<string, unknown>
        const pageNum = Number(pagination['page'] ?? 1)
        const pageSize = Number(pagination['pageSize'] ?? 20)
        const start = (pageNum - 1) * pageSize
        const items = state.all.slice(start, start + pageSize)
        return {
          data: {
            reportExports: {
              items,
              total: state.all.length,
              page: pageNum,
              pageSize,
            },
          },
        }
      },
    ],
    [
      'query ReportExport',
      (postData) => {
        counters.detailQuery++
        if (state.detailError) {
          return { errors: [{ message: 'Export not found or access denied.' }] }
        }
        const id = String(postData.variables?.['id'] ?? '')
        const item =
          state.detail && state.detail.id === id ? state.detail : state.all.find((e) => e.id === id)
        if (!item) {
          return { errors: [{ message: 'Export not found or access denied.' }] }
        }
        return { data: { reportExport: item } }
      },
    ],
    [
      'mutation ExportReport',
      async (postData) => {
        counters.exportMutation++
        lastVariables.exportReport = postData.variables
        if (state.exportGate) await state.exportGate
        const format = String(postData.variables?.['format'] ?? 'PDF')
        const status = state.exportStatus ?? 'READY'
        const ext = format === 'EXCEL' ? 'xlsx' : format.toLowerCase()
        return {
          data: {
            exportReport: {
              id: `exp-created-${counters.exportMutation}`,
              status,
              format,
              filterSummary: 'All deals · datePreset THIS_QUARTER',
              dateRangeStart: '2026-05-01T00:00:00.000Z',
              dateRangeEnd: '2026-05-31T00:00:00.000Z',
              filename:
                status === 'READY'
                  ? state.exportFilename ?? `report_2026-05-01_to_2026-05-31.${ext}`
                  : null,
              contentType: status === 'READY' ? 'application/pdf' : null,
              fileSizeBytes: status === 'READY' ? 2621440 : null,
              attemptCount: 1,
              errorCode: state.exportErrorCode ?? null,
              errorMessage: state.exportErrorMessage ?? null,
              createdAt: '2026-08-18T12:00:00.000Z',
              completedAt: status === 'READY' ? '2026-08-18T12:00:05.000Z' : null,
              report: { id: 'sales-1', name: 'August Overview', type: 'SALES_OVERVIEW' },
            },
          },
        }
      },
    ],
    [
      'mutation ReportExportDownloadUrl',
      (postData) => {
        counters.downloadUrl++
        lastVariables.downloadUrl = postData.variables
        if (state.downloadUrlError) {
          return { errors: [{ message: 'Export not found or access denied.' }] }
        }
        const id = String(postData.variables?.['id'] ?? 'unknown')
        const url =
          state.downloadUrls?.[counters.downloadUrl - 1] ??
          `${SIGNED_URL_ORIGIN}/reports/tenant-1/user-1/${id}/file.pdf?token=fresh-${counters.downloadUrl}-${Date.now()}`
        return {
          data: {
            reportExportDownloadUrl: {
              url,
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            },
          },
        }
      },
    ],
    [
      'mutation DeleteReportExport',
      (postData) => {
        counters.deleteMutation++
        lastVariables.deleteExport = postData.variables
        if (state.deleteError) {
          return { errors: [{ message: 'Failed to delete export' }] }
        }
        const id = String(postData.variables?.['id'] ?? '')
        state.all = state.all.filter((e) => e.id !== id)
        return { data: { deleteReportExport: true } }
      },
    ],
  ]

  return { handlers, counters, lastVariables }
}

// ---------------------------------------------------------------------------
// Sales workspace fixtures (AC 11/12 surface — SalesReportsWorkspace)
// ---------------------------------------------------------------------------

const SALES_REPORT_CONFIG = {
  datePreset: 'THIS_MONTH',
  startDate: null,
  endDate: null,
  comparisonMode: 'NONE',
  comparisonStartDate: null,
  comparisonEndDate: null,
  groupBy: 'MONTH',
  ownerId: null,
  teamId: null,
  stageId: null,
  productId: null,
  currency: null,
}

function makeSalesReport(overrides: Partial<MockReportRow> = {}): MockReportRow {
  return {
    id: 'sales-1',
    name: 'August Overview',
    type: 'SALES_OVERVIEW',
    isSupported: true,
    isPublic: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'user-1',
    config: SALES_REPORT_CONFIG,
    ...overrides,
  }
}

const MINIMAL_REPORT_DATA = {
  reportId: 'sales-1',
  reportType: 'SALES_OVERVIEW',
  generatedAt: '2026-08-18T12:00:00.000Z',
  dateField: 'expectedCloseDate',
  calculationNote: 'Amounts are summed without currency conversion.',
  currency: 'USD',
  mixedCurrencies: false,
  availableCurrencies: ['USD'],
  appliedFilters: SALES_REPORT_CONFIG,
  current: {
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    metrics: [
      {
        key: 'TOTAL_REVENUE',
        label: 'Total revenue',
        value: 125000,
        unit: 'CURRENCY',
        comparisonValue: null,
        percentageChange: null,
        direction: null,
        displayToken: 'NONE',
      },
    ],
    buckets: [
      {
        key: '2026-08',
        label: 'Aug 2026',
        value: 125000,
        count: 12,
        comparisonValue: null,
        percentageChange: null,
        direction: null,
        displayToken: 'NONE',
      },
    ],
    stageBreakdown: [],
  },
  comparison: null,
  drillDown: null,
}

function buildSalesWorkspaceHandlers(): Array<[string, MockHandler]> {
  return [
    [
      'query Reports',
      () => ({
        data: { reports: { items: [makeSalesReport()], total: 1, page: 1, pageSize: 20 } },
      }),
    ],
    ['query ReportData', () => ({ data: { reportData: MINIMAL_REPORT_DATA } })],
  ]
}

// ---------------------------------------------------------------------------
// Custom builder fixtures (AC 11 saved-only surface — CustomReportBuilder).
// Empty dimensions/metrics => no preview query fires (proven in
// report-schedules.spec.ts). Catalog copied from that spec.
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

function buildCustomBuilderHandlers(): Array<[string, MockHandler]> {
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

// ---------------------------------------------------------------------------
// Signed-URL cross-origin route: fulfilled deterministically with a small
// body so the Blob download is real (non-empty) without touching storage.
// ---------------------------------------------------------------------------

async function mockSignedUrlRoute(
  page: import('@playwright/test').Page,
  counters: { fetchCount: () => number },
  opts: { contentType?: string; body?: Buffer } = {},
): Promise<void> {
  const contentType = opts.contentType ?? 'application/pdf'
  const body = opts.body ?? Buffer.from('%PDF-1.4\n% e2e mock export body\n%%EOF\n')
  let fetches = 0
  counters.fetchCount = () => fetches
  await page.route(`${SIGNED_URL_ORIGIN}/**`, async (route) => {
    fetches++
    await route.fulfill({
      status: 200,
      contentType,
      body,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  })
}

// ---------------------------------------------------------------------------
// Auth env — sign with the secret the running web server accepts
// ---------------------------------------------------------------------------

test.beforeEach(async ({ context }) => {
  process.env['JWT_SECRET'] = API_JWT_SECRET
  await applyAuthCookie(context)
})

test.afterEach(() => {
  delete process.env['JWT_SECRET']
})

// ===========================================================================
// Describe A — Saved SALES report Export dropdown (binding AC 11, 12;
// contract E30-E33)
// ===========================================================================

test.describe('Saved sales report Export dropdown (AC 11/12)', () => {
  test('[P1] E2E-EX-01: shows the Export trigger on a selected saved report with exactly PDF / Excel (XLSX) / CSV options', async ({
    page,
  }) => {
    const { handlers } = buildExportHandlers({ all: [] })
    await setupGraphqlMock(page, [...handlers, ...buildSalesWorkspaceHandlers()])
    await page.goto('/reports/sales', { timeout: 120_000 })

    // Select the saved report.
    await page.getByRole('button', { name: 'August Overview' }).click()
    const trigger = page.getByRole('button', { name: 'Export report' })
    await expect(trigger).toBeVisible({ timeout: 30_000 })
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // Open the menu — exact options with icons/subtitles (AC 11).
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = page.getByRole('menu', { name: 'Export formats' })
    await expect(menu).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /PDF Document/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Excel \(\.xlsx\)/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /CSV Plain/ })).toBeVisible()
    await expect(page.getByRole('menuitem')).toHaveCount(3)
  })

  test('[P1] E2E-EX-02: menu is keyboard accessible — Enter opens, Escape closes, focus returns to the trigger', async ({
    page,
  }) => {
    const { handlers } = buildExportHandlers({ all: [] })
    await setupGraphqlMock(page, [...handlers, ...buildSalesWorkspaceHandlers()])
    await page.goto('/reports/sales', { timeout: 120_000 })

    await page.getByRole('button', { name: 'August Overview' }).click()
    const trigger = page.getByRole('button', { name: 'Export report' })
    await expect(trigger).toBeVisible({ timeout: 30_000 })

    // Keyboard open via Enter.
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu', { name: 'Export formats' })).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Tab moves focus into the menu (Radix Popover focuses its content
    // container on open, so the first Tab lands on a focusable inside it).
    await page.keyboard.press('Tab')
    const focusInMenu = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"][aria-label="Export formats"]')
      return !!menu?.contains(document.activeElement)
    })
    expect(focusInMenu).toBe(true)

    // Escape closes and restores focus to the trigger.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'Export formats' })).not.toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
  })

  test('[P1] E2E-EX-03: forwards the current runtime filters and prevents duplicate submit while in flight', async ({
    page,
  }) => {
    const gateHolder: { release: (() => void) | null } = { release: null }
    const gate = new Promise<void>((resolve) => {
      gateHolder.release = resolve
    })
    const { handlers, counters, lastVariables } = buildExportHandlers({
      all: [],
      exportStatus: 'READY',
      exportFilename: READY_FILENAME,
      exportGate: gate,
    })
    await setupGraphqlMock(page, [...handlers, ...buildSalesWorkspaceHandlers()])
    const signedFetch = { fetchCount: () => 0 }
    await mockSignedUrlRoute(page, signedFetch)
    await page.goto('/reports/sales', { timeout: 120_000 })

    await page.getByRole('button', { name: 'August Overview' }).click()
    const trigger = page.getByRole('button', { name: 'Export report' })
    await expect(trigger).toBeVisible({ timeout: 30_000 })

    // Apply a runtime filter override (Preset → This quarter).
    await page.getByLabel('Preset').selectOption('THIS_QUARTER')

    // Open the menu and trigger PDF export; the mutation is held on the gate.
    const downloadPromise = page.waitForEvent('download')
    await trigger.click()
    await page.getByRole('menuitem', { name: /PDF Document/ }).click()
    await expect.poll(() => counters.exportMutation).toBe(1)

    // While in flight the other formats are disabled — no second mutation.
    await expect(page.getByRole('menuitem', { name: /Excel \(\.xlsx\)/ })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: /CSV Plain/ })).toBeDisabled()

    // Release — READY path downloads exactly once.
    gateHolder.release?.()
    const download = await downloadPromise
    await expect.poll(() => counters.downloadUrl).toBe(1)
    expect(download.suggestedFilename()).toBe(READY_FILENAME)
    expect(signedFetch.fetchCount()).toBe(1)
    expect(counters.exportMutation).toBe(1)

    // The mutation carried reportId + format + the CURRENT applied filters.
    expect(lastVariables.exportReport).toMatchObject({
      reportId: 'sales-1',
      format: 'PDF',
    })
    expect(lastVariables.exportReport?.['filters']).toMatchObject({
      datePreset: 'THIS_QUARTER',
    })
  })

  test('[P1] E2E-EX-04: inline READY export mints one fresh signed URL and triggers exactly one Blob download with the sanitized server filename; the signed URL never becomes an anchor href or DOM text', async ({
    page,
  }) => {
    const { handlers, counters } = buildExportHandlers({
      all: [],
      exportStatus: 'READY',
      exportFilename: READY_FILENAME,
    })
    await setupGraphqlMock(page, [...handlers, ...buildSalesWorkspaceHandlers()])
    const signedFetch = { fetchCount: () => 0 }
    await mockSignedUrlRoute(page, signedFetch)
    await page.goto('/reports/sales', { timeout: 120_000 })

    await page.getByRole('button', { name: 'August Overview' }).click()
    const trigger = page.getByRole('button', { name: 'Export report' })
    await expect(trigger).toBeVisible({ timeout: 30_000 })

    const downloadPromise = page.waitForEvent('download')
    await trigger.click()
    await page.getByRole('menuitem', { name: /PDF Document/ }).click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(READY_FILENAME)
    const filePath = await download.path()
    expect(filePath).toBeTruthy()
    const size = await download.createReadStream().then(
      (s) =>
        new Promise<number>((resolve) => {
          let bytes = 0
          s?.on('data', (c: Buffer) => (bytes += c.length))
          s?.on('end', () => resolve(bytes))
        }),
    )
    expect(size).toBeGreaterThan(0)

    // Exactly one signed-URL fetch and one URL mint (contract E.33: never
    // cached in TanStack Query beyond the immediate action — the fetch uses
    // cache:no-store in browser-download.ts).
    expect(signedFetch.fetchCount()).toBe(1)
    expect(counters.downloadUrl).toBe(1)

    // The signed URL never becomes an anchor href, attribute, or DOM text
    // (security invariant 3 — bearer credentials stay out of the DOM/logs).
    const leak = await page.evaluate((host) => {
      const html = document.body.innerHTML
      return {
        inHtml: html.includes(host),
        anchorHrefs: Array.from(document.querySelectorAll('a'))
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && h.includes(host)),
      }
    }, 'mock-signed-url.example')
    expect(leak.inHtml).toBe(false)
    expect(leak.anchorHrefs).toHaveLength(0)

    // Success toast announces the download (AC 11 status announcement).
    await expect(page.getByText(/Export ready: downloading PDF/)).toBeVisible()
  })

  test('[P1] E2E-EX-05: PENDING result shows queued feedback and never attempts a download', async ({
    page,
  }) => {
    const { handlers, counters } = buildExportHandlers({ all: [], exportStatus: 'PENDING' })
    await setupGraphqlMock(page, [...handlers, ...buildSalesWorkspaceHandlers()])
    await page.goto('/reports/sales', { timeout: 120_000 })

    await page.getByRole('button', { name: 'August Overview' }).click()
    const trigger = page.getByRole('button', { name: 'Export report' })
    await expect(trigger).toBeVisible({ timeout: 30_000 })

    await trigger.click()
    await page.getByRole('menuitem', { name: /CSV Plain/ }).click()

    // Queued toast (contract E.33 queued feedback).
    await expect(page.getByText(/Export queued in background/)).toBeVisible()
    await expect.poll(() => counters.exportMutation).toBe(1)
    expect(counters.downloadUrl).toBe(0)
  })

  test('[P1] E2E-EX-06: FAILED size-limit result shows an actionable warning naming the limit and never downloads', async ({
    page,
  }) => {
    const { handlers, counters } = buildExportHandlers({
      all: [],
      exportStatus: 'FAILED',
      exportErrorCode: 'FILE_TOO_LARGE',
      exportErrorMessage: 'Export exceeds the 50 MB limit.',
    })
    await setupGraphqlMock(page, [...handlers, ...buildSalesWorkspaceHandlers()])
    await page.goto('/reports/sales', { timeout: 120_000 })

    await page.getByRole('button', { name: 'August Overview' }).click()
    const trigger = page.getByRole('button', { name: 'Export report' })
    await expect(trigger).toBeVisible({ timeout: 30_000 })

    await trigger.click()
    await page.getByRole('menuitem', { name: /Excel \(\.xlsx\)/ }).click()

    await expect(page.getByText(/Export failed: Export exceeds the 50 MB limit/)).toBeVisible()
    await expect(page.getByText(/Try narrowing date range or filters/)).toBeVisible()
    expect(counters.downloadUrl).toBe(0)
  })
})

// ===========================================================================
// Describe B — Saved CUSTOM report surface + unsaved draft gating (AC 11;
// contract E32)
// ===========================================================================

test.describe('Saved custom report Export menu (AC 11)', () => {
  test('[P1] E2E-EX-07: saved custom report export passes only reportId — no sales filter overrides', async ({
    page,
  }) => {
    const { handlers, counters, lastVariables } = buildExportHandlers({
      all: [],
      exportStatus: 'READY',
      exportFilename: 'custom-report_2026-08-01_to_2026-08-31.pdf',
    })
    await setupGraphqlMock(page, [...handlers, ...buildCustomBuilderHandlers()])
    const signedFetch = { fetchCount: () => 0 }
    await mockSignedUrlRoute(page, signedFetch)
    await page.goto('/reports/builder?reportId=custom-report-1', { timeout: 120_000 })

    const trigger = page.getByRole('button', { name: 'Export report' })
    await expect(trigger).toBeVisible({ timeout: 60_000 })
    await expect(trigger).toBeEnabled()

    const downloadPromise = page.waitForEvent('download')
    await trigger.click()
    await page.getByRole('menuitem', { name: /CSV Plain/ }).click()
    const download = await downloadPromise

    await expect.poll(() => counters.exportMutation).toBe(1)
    expect(download.suggestedFilename()).toBe('custom-report_2026-08-01_to_2026-08-31.pdf')
    expect(signedFetch.fetchCount()).toBe(1)
    // Contract B10/E32: CUSTOM sends reportId only — the saved config owns the
    // filters; a non-empty sales override would be rejected server-side.
    expect(lastVariables.exportReport).toMatchObject({ reportId: 'custom-report-1', format: 'CSV' })
    expect('filters' in (lastVariables.exportReport ?? {})).toBe(false)
  })

  test('[P1] E2E-EX-08: unsaved custom draft Export is disabled with the Save Report First hint', async ({
    page,
  }) => {
    const { handlers } = buildExportHandlers({ all: [] })
    await setupGraphqlMock(page, [...handlers, ...buildCustomBuilderHandlers()])
    await page.goto('/reports/builder', { timeout: 120_000 })

    const trigger = page.getByRole('button', { name: 'Export report' })
    await expect(trigger).toBeVisible({ timeout: 60_000 })
    await expect(trigger).toBeDisabled()
    // sr-only hint announces the save-first requirement (contract E32).
    await expect(
      page.getByText('Please save your report draft first before exporting.'),
    ).toBeVisible()
  })
})

// ===========================================================================
// Describe C — /reports/exports history page (binding AC 16; contract E34)
// ===========================================================================

test.describe('/reports/exports history page (AC 16)', () => {
  test('[P1] E2E-EX-09: populated history shows report/format/filter/date/status/size/time columns, all status badges and the 50 MB policy banner', async ({
    page,
  }) => {
    const all = [
      makeReadyExport('exp-ready-1'),
      makeExport(1, { id: 'exp-pending-1', status: 'PENDING', format: 'EXCEL' }),
      makeExport(2, { id: 'exp-processing-1', status: 'PROCESSING', format: 'CSV' }),
      makeExport(3, { id: 'exp-failed-1', status: 'FAILED', format: 'PDF' }),
    ]
    const { handlers } = buildExportHandlers({ all })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    await expect(page.getByRole('heading', { name: 'Export History & Downloads' })).toBeVisible({
      timeout: 30_000,
    })

    // Policy banner (AC 15 support — bounds visible to the user).
    await expect(page.getByTestId('size-warning-banner')).toContainText(
      '50 MB, 50,000 rows, and 50 columns',
    )

    // Columns.
    for (const header of [
      'Filename & Report',
      'Format',
      'Filter Scope & Date Range',
      'File Size',
      'Status',
      'Generated',
      'Actions',
    ]) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible()
    }

    // READY row: filename, report name, format, filter scope, date range, size, time.
    const readyRow = page.getByTestId('export-row-exp-ready-1')
    await expect(readyRow).toContainText(READY_FILENAME)
    await expect(readyRow).toContainText('August Overview')
    await expect(readyRow.getByText('PDF', { exact: true })).toBeVisible()
    await expect(readyRow).toContainText('All deals · datePreset THIS_MONTH')
    await expect(readyRow).toContainText(/2026-05-01T00:00:00\.000Z to 2026-05-31T00:00:00\.000Z/)
    await expect(readyRow).toContainText('2.50 MB')
    await expect(readyRow.locator('time')).toHaveCount(1)
    await expect(readyRow.getByText('Ready', { exact: true })).toBeVisible()

    // EXCEL renders as XLSX label.
    const pendingRow = page.getByTestId('export-row-exp-pending-1')
    await expect(pendingRow.getByText('XLSX', { exact: true })).toBeVisible()
    await expect(pendingRow.getByText('Queued', { exact: true })).toBeVisible()

    // PROCESSING badge.
    const processingRow = page.getByTestId('export-row-exp-processing-1')
    await expect(processingRow.getByText('Processing', { exact: true })).toBeVisible()

    // FAILED badge + safe error line.
    const failedRow = page.getByTestId('export-row-exp-failed-1')
    await expect(failedRow.getByText('Failed', { exact: true })).toBeVisible()
    await expect(failedRow).toContainText(
      'Export exceeds the 50 MB limit. Narrow your date range or filters.',
    )
  })

  test('[P1] E2E-EX-10: FAILED rows show the actionable 50 MB warning; PENDING/PROCESSING/FAILED rows cannot download', async ({
    page,
  }) => {
    const all = [
      makeReadyExport('exp-ready-1'),
      makeExport(1, { id: 'exp-pending-1', status: 'PENDING' }),
      makeExport(2, { id: 'exp-processing-1', status: 'PROCESSING' }),
      makeExport(3, {
        id: 'exp-failed-1',
        status: 'FAILED',
        errorCode: 'FILE_TOO_LARGE',
        errorMessage: 'Export exceeds the 50 MB limit. Narrow your date range or filters.',
      }),
    ]
    const { handlers } = buildExportHandlers({ all })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    // Only the single READY row has a Download button (AC 16: PENDING/
    // PROCESSING show progress, FAILED shows the warning — no download).
    await expect(page.getByRole('button', { name: /^Download / })).toHaveCount(1)

    // FAILED warning is visible and names the limit (AC 15).
    await expect(
      page
        .getByTestId('export-row-exp-failed-1')
        .getByText('Export exceeds the 50 MB limit. Narrow your date range or filters.'),
    ).toBeVisible()

    // Row-level actions are still present (delete on every row).
    await expect(page.getByRole('button', { name: /Delete export/ })).toHaveCount(4)
  })

  test('[P1] E2E-EX-11: history is newest-first and paginated (page 2 loads via the pagination variables)', async ({
    page,
  }) => {
    const all = Array.from({ length: 25 }, (_, i) =>
      makeExport(i, {
        id: `exp-${String(i + 1).padStart(2, '0')}`,
        status: 'READY',
        report: { id: 'sales-1', name: `Sales Report ${i + 1}`, type: 'SALES_OVERVIEW' },
      }),
    )
    const { handlers } = buildExportHandlers({ all })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    // Newest-first: the first row is item 1, the last visible is item 20.
    await expect(page.getByTestId('export-row-exp-01')).toBeVisible({ timeout: 30_000 })
    const firstRow = page.locator('tbody tr').first()
    await expect(firstRow).toContainText('Sales Report 1')
    await expect(page.locator('tbody tr').nth(19)).toContainText('Sales Report 20')

    await expect(page.getByText(/Showing 1-20 of 25 export records/)).toBeVisible()

    // Next page — query must carry pagination.page=2.
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText(/Showing 21-25 of 25 export records/)).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('export-row-exp-21')).toBeVisible()
    await expect(page.getByText('Sales Report 25').first()).toBeVisible()
    await expect(page.getByText('Sales Report 1').first()).not.toBeVisible()

    // Previous returns to page 1.
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.getByTestId('export-row-exp-01')).toBeVisible({ timeout: 15_000 })
  })

  test('[P1] E2E-EX-12: READY re-download mints a FRESH signed URL on every click and downloads each time', async ({
    page,
  }) => {
    const all = [makeReadyExport('exp-ready-1')]
    const { handlers, counters } = buildExportHandlers({ all })
    await setupGraphqlMock(page, handlers)
    const signedFetch = { fetchCount: () => 0 }
    await mockSignedUrlRoute(page, signedFetch)
    await page.goto('/reports/exports', { timeout: 120_000 })

    const downloadBtn = page.getByRole('button', { name: /^Download / })
    await expect(downloadBtn).toBeVisible({ timeout: 30_000 })

    // First click.
    const firstDownload = page.waitForEvent('download')
    await downloadBtn.click()
    const d1 = await firstDownload
    expect(d1.suggestedFilename()).toBe(READY_FILENAME)
    expect(counters.downloadUrl).toBe(1)

    // Second click — a NEW signed URL is minted (contract D28: fresh
    // 86,400-second URL per call; the mock mints a distinct URL per call).
    const secondDownload = page.waitForEvent('download')
    await downloadBtn.click()
    const d2 = await secondDownload
    expect(d2.suggestedFilename()).toBe(READY_FILENAME)
    expect(counters.downloadUrl).toBe(2)
    expect(signedFetch.fetchCount()).toBe(2)

    // Freshness: two URL mints happened (the mock generates a unique URL per
    // call with a per-call token) — the UI never reuses a cached URL.
    const paths = await Promise.all([d1.path(), d2.path()])
    expect(paths[0]).toBeTruthy()
    expect(paths[1]).toBeTruthy()
  })

  test('[P1] E2E-EX-13: delete confirms, removes the row and invalidates the list; dialog closes on success', async ({
    page,
  }) => {
    const all = [
      makeReadyExport('exp-ready-1'),
      makeExport(1, { id: 'exp-pending-1', status: 'PENDING' }),
    ]
    const { handlers, counters } = buildExportHandlers({ all })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    await page.getByRole('button', { name: `Delete export ${READY_FILENAME}` }).click()
    await expect(page.getByRole('heading', { name: 'Delete Export History' })).toBeVisible()
    await expect(
      page.getByText(
        /Are you sure you want to remove .*sales-report_2026-05-01_to_2026-05-31_owner-a1b2c3d4\.pdf/,
      ),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Delete Export', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Export history deleted')).toBeVisible()

    // Row removed after query invalidation + refetch (contract E34).
    await expect(page.getByTestId('export-row-exp-ready-1')).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('export-row-exp-pending-1')).toBeVisible()
    expect(counters.deleteMutation).toBe(1)
  })

  test('[P1] E2E-EX-14: delete error keeps the row and surfaces a toast without closing the dialog', async ({
    page,
  }) => {
    const all = [makeReadyExport('exp-ready-1')]
    const { handlers, counters } = buildExportHandlers({ all, deleteError: true })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    await page.getByRole('button', { name: `Delete export ${READY_FILENAME}` }).click()
    await page.getByRole('button', { name: 'Delete Export', exact: true }).click()

    await expect(page.getByText('Failed to delete export')).toBeVisible()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByTestId('export-row-exp-ready-1')).toBeVisible()
    expect(counters.deleteMutation).toBe(1)

    // Cancel still closes the dialog and leaves the row.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByTestId('export-row-exp-ready-1')).toBeVisible()
  })
})

// ===========================================================================
// Describe D — Notification deep links (binding AC 9; contract E35/F5)
// ===========================================================================

test.describe('?download= and ?exportId= deep links (AC 9)', () => {
  test('[P1] E2E-EX-15: ?download=<on-page READY id> mints/downloads exactly once, clears the param, and never re-downloads after reload', async ({
    page,
  }) => {
    const all = [makeReadyExport('exp-ready-1')]
    const { handlers, counters } = buildExportHandlers({ all })
    await setupGraphqlMock(page, handlers)
    const signedFetch = { fetchCount: () => 0 }
    await mockSignedUrlRoute(page, signedFetch)

    const downloadPromise = page.waitForEvent('download')
    await page.goto('/reports/exports?download=exp-ready-1', { timeout: 120_000 })
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe(READY_FILENAME)
    expect(counters.downloadUrl).toBe(1)
    expect(signedFetch.fetchCount()).toBe(1)

    // The query param is cleared (contract E35 — no loop on re-render).
    await expect(page).toHaveURL(/\/reports\/exports$/, { timeout: 15_000 })

    // Reload: no param → no further mint/download.
    await page.reload({ timeout: 120_000 })
    await expect(page).toHaveURL(/\/reports\/exports$/)
    await page.waitForTimeout(1500)
    expect(counters.downloadUrl).toBe(1)
    expect(signedFetch.fetchCount()).toBe(1)
  })

  test('[P1] E2E-EX-16: ?download=<off-page id> fetches the item via reportExport and downloads exactly once', async ({
    page,
  }) => {
    // Target is NOT on page 1 — the page must fetch the detail query (M3).
    const all = [makeExport(1, { id: 'exp-other', status: 'READY', filename: 'other-report.pdf' })]
    const offPage = makeReadyExport('exp-off-page', {
      filename: 'off-page-report_2026-05-01_to_2026-05-31.pdf',
    })
    const { handlers, counters } = buildExportHandlers({ all, detail: offPage })
    await setupGraphqlMock(page, handlers)
    const signedFetch = { fetchCount: () => 0 }
    await mockSignedUrlRoute(page, signedFetch)

    const downloadPromise = page.waitForEvent('download')
    await page.goto('/reports/exports?download=exp-off-page', { timeout: 120_000 })
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe('off-page-report_2026-05-01_to_2026-05-31.pdf')
    expect(counters.detailQuery).toBeGreaterThanOrEqual(1)
    expect(counters.downloadUrl).toBe(1)
    expect(signedFetch.fetchCount()).toBe(1)
    await expect(page).toHaveURL(/\/reports\/exports$/, { timeout: 15_000 })
  })

  test('[P1] E2E-EX-17: ?download=<FAILED id> renders an actionable error and never downloads', async ({
    page,
  }) => {
    const all = [
      makeExport(3, {
        id: 'exp-failed-1',
        status: 'FAILED',
        errorCode: 'FILE_TOO_LARGE',
        errorMessage: 'Export exceeds the 50 MB limit.',
      }),
    ]
    const { handlers, counters } = buildExportHandlers({ all })
    await setupGraphqlMock(page, handlers)

    await page.goto('/reports/exports?download=exp-failed-1', { timeout: 120_000 })
    await expect(page.getByText(/Export failed: Export exceeds the 50 MB limit/)).toBeVisible()
    await expect(page.getByText(/Narrow your date range or filters/)).toBeVisible()
    expect(counters.downloadUrl).toBe(0)
    await expect(page).toHaveURL(/\/reports\/exports$/, { timeout: 15_000 })
  })

  test('[P1] E2E-EX-18: ?download=<missing id> shows the not-found error and never downloads', async ({
    page,
  }) => {
    const { handlers, counters } = buildExportHandlers({ all: [], detailError: true })
    await setupGraphqlMock(page, handlers)

    await page.goto('/reports/exports?download=exp-missing', { timeout: 120_000 })
    await expect(page.getByText('Export not found or access denied.')).toBeVisible()
    expect(counters.downloadUrl).toBe(0)
    await expect(page).toHaveURL(/\/reports\/exports$/, { timeout: 15_000 })
  })

  test('[P1] E2E-EX-19: ?exportId=<id> highlights the row without auto-downloading', async ({
    page,
  }) => {
    const all = [
      makeReadyExport('exp-ready-1'),
      makeExport(1, { id: 'exp-other', status: 'READY', filename: 'other.pdf' }),
    ]
    const { handlers, counters } = buildExportHandlers({ all })
    await setupGraphqlMock(page, handlers)

    await page.goto('/reports/exports?exportId=exp-ready-1', { timeout: 120_000 })

    const row = page.getByTestId('export-row-exp-ready-1')
    await expect(row).toBeVisible({ timeout: 30_000 })
    // Highlight styling (ring + tint), no auto-download (contract E35/F5).
    await expect(row).toHaveClass(/ring-indigo-400/)
    await expect(page.getByTestId('export-row-exp-other')).not.toHaveClass(/ring-indigo-400/)
    await page.waitForTimeout(1000)
    expect(counters.downloadUrl).toBe(0)
  })
})

// ===========================================================================
// Describe E — Loading / empty / error / permission states (contract E34)
// ===========================================================================

test.describe('History page states (contract E34)', () => {
  test('[P1] E2E-EX-20: shows the loading skeleton while the list query is pending', async ({
    page,
  }) => {
    const { handlers } = buildExportHandlers({ all: [], listDelayMs: 2500 })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    await expect(page.getByTestId('exports-table-skeleton')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('exports-table-skeleton')).not.toBeVisible({ timeout: 15_000 })
  })

  test('[P1] E2E-EX-21: renders the empty state with guidance to export from a saved report', async ({
    page,
  }) => {
    const { handlers } = buildExportHandlers({ all: [] })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    await expect(page.getByText('No export records found')).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText(
        'You have not exported any reports yet. Use the Export button on any saved report.',
      ),
    ).toBeVisible()
  })

  test('[P1] E2E-EX-22: GraphQL error shows the error state and Retry recovers', async ({
    page,
  }) => {
    const all = [makeReadyExport('exp-ready-1')]
    const { handlers } = buildExportHandlers({ all, listErrorForFirst: 4 })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    await expect(page.getByText('Could not load export history')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Failed to fetch export history')).toBeVisible()
    await expect(page.getByRole('button', { name: /Try again/i })).toBeVisible()

    await page.getByRole('button', { name: /Try again/i }).click()
    await expect(page.getByTestId('export-row-exp-ready-1')).toBeVisible({ timeout: 15_000 })
  })

  test('[P1] E2E-EX-23: users without REPORT:READ see the permission-limited state', async ({
    page,
  }) => {
    const { handlers } = buildExportHandlers({ all: [], permissions: noReportPermissions() })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    await expect(page.getByText('You do not have permission to view export history.')).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole('heading', { name: 'Export History & Downloads' }),
    ).not.toBeVisible()
  })
})

// ===========================================================================
// Describe F — 320px mobile layout + navigation (contract E34/F7/F8, B12)
// ===========================================================================

test.describe('Mobile layout (contract E34/F7, B12)', () => {
  test.use({ viewport: { width: 320, height: 800 } })

  test('[P1] E2E-EX-24: at 320px history renders cards without horizontal overflow and touch targets are >= 44px', async ({
    page,
  }) => {
    const all = [
      makeReadyExport('exp-ready-1'),
      makeExport(1, { id: 'exp-failed-1', status: 'FAILED' }),
    ]
    const { handlers } = buildExportHandlers({ all })
    await setupGraphqlMock(page, [...handlers, ...buildSalesWorkspaceHandlers()])
    await page.goto('/reports/exports', { timeout: 120_000 })

    // Mobile cards replace the table.
    await expect(page.getByTestId('export-card-exp-ready-1')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('export-card-exp-failed-1')).toBeVisible()
    await expect(page.locator('table')).not.toBeVisible()

    // No horizontal page overflow (B12).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // Touch targets >= 44x44: download, delete, export trigger.
    const downloadBtn = page.getByRole('button', { name: /^Download / })
    const downloadBox = await downloadBtn.boundingBox()
    expect(downloadBox?.width).toBeGreaterThanOrEqual(44)
    expect(downloadBox?.height).toBeGreaterThanOrEqual(44)

    const deleteBtn = page.getByRole('button', { name: /Delete export/ }).first()
    const deleteBox = await deleteBtn.boundingBox()
    expect(deleteBox?.width).toBeGreaterThanOrEqual(44)
    expect(deleteBox?.height).toBeGreaterThanOrEqual(44)

    // Export menu trigger lives on the sales workspace — assert its target
    // size at 320px as well (contract E30-31: min-h/min-w 44px).
    await page.goto('/reports/sales', { timeout: 120_000 })
    await page.getByRole('button', { name: 'August Overview' }).click()
    const exportTrigger = page.getByRole('button', { name: 'Export report' })
    await expect(exportTrigger).toBeVisible({ timeout: 60_000 })
    const exportBox = await exportTrigger.boundingBox()
    expect(exportBox?.width).toBeGreaterThanOrEqual(44)
    expect(exportBox?.height).toBeGreaterThanOrEqual(44)
  })
})

// ===========================================================================
// Describe G — Navigation (contract E34/F8): desktop sidebar + breadcrumb.
// Runs at the default Desktop Chrome viewport (>= lg) where the sidebar and
// breadcrumb are rendered (both are hidden below 1024px).
// ===========================================================================

test.describe('Navigation (contract E34/F8)', () => {
  test('[P1] E2E-EX-25: nav "Exports" link and breadcrumb route to /reports/exports', async ({
    page,
  }) => {
    const { handlers } = buildExportHandlers({ all: [] })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/exports', { timeout: 120_000 })

    // AppShell report navigation entry, gated on REPORT:READ (contract E34).
    const nav = page.getByRole('navigation', { name: /crm navigation/i })
    const exportsLink = nav.getByRole('link', { name: 'Exports' })
    await expect(exportsLink).toBeVisible({ timeout: 30_000 })
    await expect(exportsLink).toHaveAttribute('href', '/reports/exports')

    // Breadcrumb: CRM / Reports / Exports.
    const breadcrumb = page.locator('nav[aria-label="breadcrumb"]')
    await expect(breadcrumb.getByRole('link', { name: 'CRM' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    await expect(breadcrumb.getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/reports',
    )
    await expect(breadcrumb.getByText('Exports', { exact: true })).toBeVisible()
  })
})
