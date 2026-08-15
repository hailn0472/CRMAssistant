import { expect, test } from '@playwright/test'
import { applyAuthCookie } from '../support/helpers/auth'

// The web dev server runs `pnpm --filter=web dev` → `infisical run
// --env=dev --path=/apps/web -- next dev`, so it signs/verifies JWTs with
// the Infisical-injected JWT_SECRET (same secret the API uses), NOT the
// Playwright default. The auth cookie must be signed with that same secret
// or the middleware redirects to /login. Same pattern as
// contact-timeline.spec.ts (API_JWT_SECRET).
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'

// ---------------------------------------------------------------------------
// Story 6.3 (AC 18, Contract E.37): the complete builder workflow —
// authenticate, open /reports/builder, select Deals, apply a filter,
// add/reorder one dimension + one metric through the accessible controls,
// choose a compatible chart, observe the live preview, save, verify the
// Custom badge in the report list, reopen via the edit URL, change config,
// re-save and verify persistence after reload. GraphQL is mocked at the
// route level (same pattern as contact-timeline.spec.ts) so the web app runs
// standalone.
//
// Selector notes (aligned with the shipped app):
// - "Add filter" defaults to the FIRST filterable catalogue field, which is
//   "Created at" (date) for DEALS — the spec therefore selects the Stage
//   field explicitly via the "Filter field" select before typing the value.
// - deal.id is a non-numeric count metric; a BAR chart requires a numeric
//   metric, so the metric used here is deal.value (NUMBER/currency, SUM) —
//   the classic "Revenue by stage" report.
// - After the second save the visualization is TABLE, so the post-reload
//   preview is a data table, not a role="img" chart.
// ---------------------------------------------------------------------------

type MockHandler = (postData: {
  query: string
  variables?: Record<string, unknown>
}) => { data: unknown } | Promise<{ data: unknown }>

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

// Self-consistent DEALS catalogue mirroring the real backend contract
// (apps/api/src/reports/custom-report-catalog.ts): deal.id is a METRIC-only
// count field, deal.createdAt/stage/status are filter+dimension fields, and
// deal.value is the numeric (currency) field with full aggregation support.
const DEALS_CATALOG = {
  dataSource: 'DEALS',
  fields: [
    {
      key: 'deal.id',
      label: 'Deal ID',
      valueType: 'STRING',
      roles: ['METRIC'],
      aggregations: ['COUNT', 'DISTINCT_COUNT'],
      filterOperators: [],
      relationKind: null,
      isNumeric: false,
      isCurrency: false,
      isDate: false,
    },
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
      key: 'deal.status',
      label: 'Status',
      valueType: 'ENUM',
      roles: ['FILTER', 'DIMENSION', 'METRIC'],
      aggregations: ['COUNT', 'DISTINCT_COUNT'],
      filterOperators: ['EQ', 'NOT_EQ', 'IN'],
      relationKind: null,
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

function configFromVariables(variables: Record<string, unknown>): Record<string, unknown> {
  return (variables['config'] ?? {}) as Record<string, unknown>
}

// Derive the preview result from the actual config so the mock stays coherent
// no matter which dimensions/metrics the builder sends (one writer rule:
// the savedReport closure is the only state; everything else derives from it).
function previewResult(config: Record<string, unknown>) {
  const metrics = (config['metrics'] ?? []) as Array<{
    id: string
    fieldId: string
    aggregation: string
    alias: string
  }>
  const dimensions = (config['dimensions'] ?? []) as Array<{
    id: string
    fieldId: string | null
    granularity: string | null
  }>
  const fieldByKey = new Map(DEALS_CATALOG.fields.map((f) => [f.key, f]))

  const columns = [
    ...dimensions.map((d) => {
      const field = d.fieldId ? fieldByKey.get(d.fieldId) : undefined
      return {
        fieldId: d.fieldId ?? 'calculated',
        label: field?.label ?? d.fieldId ?? 'Calculated',
        valueType: field?.valueType ?? 'STRING',
        role: 'DIMENSION',
        aggregation: null,
        granularity: d.granularity ?? null,
        isCalculated: false,
      }
    }),
    ...metrics.map((m) => {
      const field = fieldByKey.get(m.fieldId)
      return {
        fieldId: m.fieldId,
        label: field?.label ?? m.fieldId,
        valueType: field?.valueType ?? 'STRING',
        role: 'METRIC',
        aggregation: m.aggregation,
        granularity: null,
        isCalculated: false,
      }
    }),
  ]

  const rows = [
    {
      key: 'Proposal',
      cells: [
        ...dimensions.map((d) => {
          const field = d.fieldId ? fieldByKey.get(d.fieldId) : undefined
          return {
            fieldId: d.fieldId ?? 'calculated',
            label: field?.label ?? d.fieldId ?? 'Calculated',
            valueType: field?.valueType ?? 'STRING',
            stringValue: 'Proposal',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          }
        }),
        ...metrics.map((m) => {
          const field = fieldByKey.get(m.fieldId)
          return {
            fieldId: m.fieldId,
            label: field?.label ?? m.fieldId,
            valueType: field?.valueType ?? 'STRING',
            stringValue: null,
            numberValue: 12,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          }
        }),
      ],
    },
  ]

  return {
    reportId: null,
    generatedAt: '2026-08-16T12:00:00.000Z',
    config,
    columns,
    rows,
    totalRows: 1,
    series: metrics.map((m) => ({
      metricId: m.id,
      label: m.alias,
      points: dimensions.length > 0 ? [{ label: 'Proposal', value: 12 }] : [],
    })),
    warnings: [],
    pagination: { page: 1, pageSize: 50, totalPages: 1 },
    truncated: false,
  }
}

test.beforeEach(async ({ context }) => {
  // Sign the auth cookie with the secret the web server actually accepts.
  process.env['JWT_SECRET'] = API_JWT_SECRET
  await applyAuthCookie(context)
})

test.afterEach(() => {
  // Unset to avoid leaking the Infisical secret to other specs in this worker.
  delete process.env['JWT_SECRET']
})

test('custom report builder: select → filter → fields → preview → save → badge → edit → re-save → persist (AC 18)', async ({
  page,
}) => {
  // Stateful mock: the saved report is created by saveCustomReport and then
  // served by the reports list and customReportData (edit mode).
  let savedReport: {
    id: string
    name: string
    config: Record<string, unknown>
    isPublic: boolean
  } | null = null

  // Captures the config of the last preview request so the test can assert
  // that the dimension reorder actually reached the preview pipeline.
  let lastPreviewConfig: Record<string, unknown> | null = null

  await setupGraphqlMock(page, [
    [
      'query MyPermissions',
      () => ({
        data: {
          myPermissions: ['REPORT', 'DEAL'].flatMap((resource) =>
            ['READ', 'CREATE', 'UPDATE'].map((action) => ({ resource, action, granted: true })),
          ),
        },
      }),
    ],
    [
      'query Reports',
      () => ({
        data: {
          reports: {
            items: savedReport
              ? [
                  {
                    id: 'sales-1',
                    name: 'August Overview',
                    type: 'SALES_OVERVIEW',
                    isSupported: true,
                    isPublic: false,
                    createdAt: '2026-08-01T00:00:00.000Z',
                    updatedAt: '2026-08-01T00:00:00.000Z',
                    createdBy: 'user-1',
                    config: { datePreset: 'THIS_MONTH' },
                  },
                  {
                    id: savedReport.id,
                    name: savedReport.name,
                    type: 'CUSTOM',
                    isSupported: true,
                    isPublic: savedReport.isPublic,
                    createdAt: '2026-08-16T00:00:00.000Z',
                    updatedAt: '2026-08-16T00:00:00.000Z',
                    createdBy: 'user-1',
                    config: null,
                  },
                ]
              : [
                  {
                    id: 'sales-1',
                    name: 'August Overview',
                    type: 'SALES_OVERVIEW',
                    isSupported: true,
                    isPublic: false,
                    createdAt: '2026-08-01T00:00:00.000Z',
                    updatedAt: '2026-08-01T00:00:00.000Z',
                    createdBy: 'user-1',
                    config: { datePreset: 'THIS_MONTH' },
                  },
                ],
            total: savedReport ? 2 : 1,
            page: 1,
            pageSize: 20,
          },
        },
      }),
    ],
    [
      'query CustomReportFieldCatalog',
      () => ({ data: { customReportFieldCatalog: DEALS_CATALOG } }),
    ],
    [
      'query CustomReportPreview',
      (postData) => {
        lastPreviewConfig = configFromVariables(postData.variables ?? {})
        return {
          data: {
            customReportPreview: previewResult(lastPreviewConfig),
          },
        }
      },
    ],
    [
      'query CustomReportData',
      () => ({
        data: {
          customReportData: savedReport
            ? previewResult(savedReport.config)
            : {
                reportId: null,
                generatedAt: '2026-08-16T12:00:00.000Z',
                config: {},
                columns: [],
                rows: [],
                totalRows: 0,
                series: [],
                warnings: [],
                pagination: { page: 1, pageSize: 50, totalPages: 0 },
                truncated: false,
              },
        },
      }),
    ],
    [
      'mutation SaveCustomReport',
      (postData) => {
        const variables = postData.variables ?? {}
        const config = configFromVariables(variables)
        savedReport = {
          id: 'custom-report-1',
          name: String(variables['name'] ?? 'Untitled'),
          config,
          isPublic: Boolean(variables['isPublic']),
        }
        return {
          data: {
            saveCustomReport: {
              id: savedReport.id,
              name: savedReport.name,
              isPublic: savedReport.isPublic,
              createdAt: '2026-08-16T00:00:00.000Z',
              updatedAt: '2026-08-16T00:00:00.000Z',
              createdBy: 'user-1',
              config,
            },
          },
        }
      },
    ],
  ])

  // ── 1. Open the builder and select Deals ────────────────────────────
  // First navigation after a cold Next.js dev boot compiles the route on
  // demand — allow generous timeouts for the first render only.
  await page.goto('/reports/builder', { timeout: 120_000 })
  await expect(page.getByRole('heading', { name: 'Custom report builder' })).toBeVisible({
    timeout: 60_000,
  })
  await page.getByRole('button', { name: /Deals/ }).click()

  // ── 2. Apply a filter (stage = Proposal) ────────────────────────────
  // "Add filter" defaults to the first filterable field (Created at, a date
  // input); select the Stage field explicitly via the accessible controls.
  await page.getByRole('button', { name: /Add filter/ }).click()
  await page.getByLabel('Filter field').selectOption('deal.stage')
  // exact: the palette's "Add Value as dimension/metric" buttons also contain
  // "Value" in their accessible names.
  await page.getByLabel('Value', { exact: true }).fill('Proposal')
  await expect(page.getByLabel('Active filters')).toContainText('Stage')
  await expect(page.getByLabel('Active filters')).toContainText('Proposal')

  // ── 3. Add dimensions + a metric through accessible controls ────────
  await page.getByRole('button', { name: 'Add Stage as dimension' }).click()
  await page.getByRole('button', { name: 'Add Status as dimension' }).click()
  // deal.value is the numeric (currency) metric — deal.id is a non-numeric
  // count metric and would make the BAR chart (step 4) incompatible.
  await page.getByRole('button', { name: 'Add Value as metric' }).click()

  // Reorder the dimensions via the keyboard-accessible Move buttons and
  // verify the reordered config actually reaches the preview pipeline.
  await page.getByRole('button', { name: 'Move up dimension Status' }).click()
  await expect
    .poll(() => {
      const dimensions = (lastPreviewConfig?.['dimensions'] ?? []) as Array<{
        fieldId: string | null
      }>
      return dimensions.map((d) => d.fieldId)
    })
    .toEqual(['deal.status', 'deal.stage'])

  // ── 4. Choose a compatible chart (BAR: 1–2 dims + numeric metric) ───
  await page.getByRole('button', { name: /Bar/ }).click()

  // ── 5. Observe the live preview (debounced) ─────────────────────────
  // Scope to the chart container: Recharts legend icons also have role="img".
  await expect(page.getByRole('img', { name: /chart for Report preview/ })).toBeVisible()
  // "Proposal" appears in the active-filter chip, the chart X-axis tick and
  // the sr-only data table — any of them proves the live preview.
  await expect(page.getByText('Proposal').first()).toBeVisible()

  // ── 6. Save ─────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Save report/ }).click()
  await page.getByLabel('Report name').fill('Revenue by stage')
  await page.getByRole('button', { name: 'Create report' }).click()
  await expect(page).toHaveURL(/\/reports\/builder\?reportId=custom-report-1/)

  // ── 7. Custom badge in the report list ──────────────────────────────
  await page.goto('/reports/sales')
  const customRow = page.getByRole('button', { name: /Revenue by stage/ })
  await expect(customRow).toBeVisible()
  await expect(customRow.getByText('Custom')).toBeVisible()

  // ── 8. Reopen via the edit URL and re-save changed config ───────────
  await customRow.click()
  await expect(page).toHaveURL(/\/reports\/builder\?reportId=custom-report-1/)
  await expect(page.getByRole('heading', { name: 'Custom report builder' })).toBeVisible()
  // The saved config is loaded and previewed (BAR chart at this point).
  await expect(page.getByRole('img', { name: /chart for Report preview/ })).toBeVisible()

  // Change the chart type and re-save.
  await page.getByRole('button', { name: /Table/ }).click()
  await page.getByRole('button', { name: /Save report/ }).click()
  await page.getByLabel('Report name').fill('Revenue by stage v2')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page).toHaveURL(/\/reports\/builder\?reportId=custom-report-1/)

  // ── 9. Persistence after reload ─────────────────────────────────────
  // The re-saved visualization is TABLE, so the reloaded preview is a data
  // table (not a role="img" chart).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Custom report builder' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByText('Proposal').first()).toBeVisible()

  await page.goto('/reports/sales')
  await expect(page.getByRole('button', { name: /Revenue by stage v2/ })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Revenue by stage v2/ }).getByText('Custom'),
  ).toBeVisible()
})
