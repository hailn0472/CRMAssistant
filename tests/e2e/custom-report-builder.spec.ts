import { readFileSync } from 'node:fs'

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
  // (Story 6.4 ReportChart figures carry aria-label = chart title, falling
  // back to "<TYPE> Chart" when no title is configured.)
  await expect(page.getByRole('img', { name: 'BAR Chart', exact: true })).toBeVisible()
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
  await expect(page.getByRole('img', { name: 'BAR Chart', exact: true })).toBeVisible()

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

// ---------------------------------------------------------------------------
// Story 6.4 (Contract G.41 / AC 4, 12, 15, 17): workflow E2E extension —
// 9-option chart selector, legend toggle, zoom/pan/reset, drill-down Sheet and
// PNG/SVG export with non-empty / MIME / signature verification. Visual
// assertions stay in report-chart-visual-regression.spec.ts so workflow
// failures remain diagnosable (no toHaveScreenshot in this file).
// ---------------------------------------------------------------------------

const STAGE_LABELS = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']
const STATUS_LABELS = ['OPEN', 'WON', 'LOST', 'PAUSED']
const FUNNEL_STAGE_VALUES = [500, 320, 180, 95, 42]
const SCATTER_X = [12.5, 18.2, 25.0, 9.8, 32.4, 21.1, 15.6, 28.9, 11.4, 24.7, 19.3, 30.2]
const SCATTER_Y = [8.2, 9.1, 11.5, 6.4, 14.2, 10.3, 8.9, 12.8, 7.1, 11.9, 9.8, 13.4]
const CATEGORY_VALUES = [42, 26, 18, 9, 5, 4]

/**
 * Coherent deterministic point defs for every chart type the builder can
 * request: 40 monthly points for LINE/AREA (exercises the zoom/pan window),
 * stage×status cells for HEATMAP, 12 labelled pairs for SCATTER, stage
 * categories for BAR/PIE/DONUT/FUNNEL.
 */
function pointDefsFor(
  config: Record<string, unknown>,
): Array<{ key: string; label: string; dimensionLabels: string[]; base: number }> {
  const viz = (config['visualization'] ?? {}) as Record<string, unknown>
  const chartType = String(viz['type'] ?? 'TABLE')

  if (chartType === 'LINE' || chartType === 'AREA') {
    return Array.from({ length: 40 }, (_, i) => {
      const label = `2026-${String((i % 12) + 1).padStart(2, '0')}`
      return { key: `p-${i}`, label, dimensionLabels: [label], base: 100 + i * 37 }
    })
  }

  if (chartType === 'HEATMAP') {
    const cells: Array<{ key: string; label: string; dimensionLabels: string[]; base: number }> = []
    for (let x = 0; x < STAGE_LABELS.length; x++) {
      for (let y = 0; y < STATUS_LABELS.length; y++) {
        const xLabel = STAGE_LABELS[x]!
        const yLabel = STATUS_LABELS[y]!
        cells.push({
          key: `cell-${x}-${y}`,
          label: `${xLabel} × ${yLabel}`,
          dimensionLabels: [xLabel, yLabel],
          base: 10 + x * 8 + y * 5,
        })
      }
    }
    return cells
  }

  if (chartType === 'SCATTER') {
    return Array.from({ length: 12 }, (_, i) => {
      const label = `Deal ${String(i + 1).padStart(2, '0')}`
      return { key: `pt-${i}`, label, dimensionLabels: [label], base: 0 }
    })
  }

  if (chartType === 'FUNNEL') {
    return FUNNEL_STAGE_VALUES.map((base, i) => ({
      key: `stage-${i}`,
      label: STAGE_LABELS[i]!,
      dimensionLabels: [STAGE_LABELS[i]!],
      base,
    }))
  }

  return STAGE_LABELS.map((label, i) => ({
    key: `s-${i}`,
    label,
    dimensionLabels: [label],
    base: CATEGORY_VALUES[i]!,
  }))
}

/** Preview result derived from the ACTUAL request config (one-writer rule). */
function richPreviewResult(config: Record<string, unknown>) {
  const viz = (config['visualization'] ?? {}) as Record<string, unknown>
  const chartType = String(viz['type'] ?? 'TABLE')
  const dimensions = (config['dimensions'] ?? []) as Array<{
    id: string
    fieldId: string | null
    granularity: string | null
  }>
  const metrics = (config['metrics'] ?? []) as Array<{
    id: string
    fieldId: string
    aggregation: string
    alias: string
  }>
  const fieldByKey = new Map(DEALS_CATALOG.fields.map((f) => [f.key, f]))
  const defs = pointDefsFor(config)
  const isScatter = chartType === 'SCATTER'

  const series = metrics.map((m, metricIndex) => ({
    metricId: m.id,
    label: m.alias,
    points: defs.map((d, i) => ({
      key: d.key,
      label: d.label,
      dimensionLabels: d.dimensionLabels,
      value: isScatter
        ? metricIndex === 0
          ? SCATTER_X[i]!
          : SCATTER_Y[i]!
        : d.base + metricIndex * 37,
    })),
  }))

  const columns = [
    ...dimensions.map((d) => ({
      fieldId: d.fieldId ?? 'calculated',
      label:
        (d.fieldId ? fieldByKey.get(d.fieldId)?.label : undefined) ?? d.fieldId ?? 'Calculated',
      valueType: d.fieldId ? fieldByKey.get(d.fieldId)?.valueType ?? 'STRING' : 'STRING',
      role: 'DIMENSION',
      aggregation: null,
      granularity: d.granularity,
      isCalculated: false,
    })),
    ...metrics.map((m) => ({
      fieldId: m.fieldId,
      label: fieldByKey.get(m.fieldId)?.label ?? m.fieldId,
      valueType: fieldByKey.get(m.fieldId)?.valueType ?? 'NUMBER',
      role: 'METRIC',
      aggregation: m.aggregation,
      granularity: null,
      isCalculated: false,
    })),
  ]

  const firstPoint = defs[0] ?? { key: 'row-0', label: 'Proposal', dimensionLabels: ['Proposal'] }
  const rows = [
    {
      key: `row-${firstPoint.key}`,
      cells: [
        ...dimensions.map((d) => ({
          fieldId: d.fieldId ?? 'calculated',
          label:
            (d.fieldId ? fieldByKey.get(d.fieldId)?.label : undefined) ?? d.fieldId ?? 'Calculated',
          valueType: d.fieldId ? fieldByKey.get(d.fieldId)?.valueType ?? 'STRING' : 'STRING',
          stringValue: firstPoint.dimensionLabels[dimensions.indexOf(d)] ?? firstPoint.label,
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        })),
        ...metrics.map((m) => ({
          fieldId: m.fieldId,
          label: fieldByKey.get(m.fieldId)?.label ?? m.fieldId,
          valueType: fieldByKey.get(m.fieldId)?.valueType ?? 'NUMBER',
          stringValue: null,
          numberValue: 12,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        })),
      ],
    },
  ]

  return {
    reportId: null,
    generatedAt: '2026-08-16T12:00:00.000Z',
    config,
    columns,
    rows,
    totalRows: rows.length,
    series,
    warnings: [],
    pagination: { page: 1, pageSize: 50, totalPages: 1 },
    truncated: false,
  }
}

/**
 * Open the builder on Deals with the standard mock set (permissions, catalog,
 * preview). Handlers passed first win over the defaults (first-match routing).
 */
async function openBuilderWithDeals(
  page: import('@playwright/test').Page,
  handlers: Array<[string, MockHandler]> = [],
): Promise<void> {
  await setupGraphqlMock(page, [
    [
      'query MyPermissions',
      () => ({
        data: {
          myPermissions: ['REPORT', 'DEAL', 'CONTACT'].flatMap((resource) =>
            ['READ', 'CREATE', 'UPDATE'].map((action) => ({ resource, action, granted: true })),
          ),
        },
      }),
    ],
    [
      'query CustomReportFieldCatalog',
      () => ({ data: { customReportFieldCatalog: DEALS_CATALOG } }),
    ],
    ...handlers,
    [
      'query CustomReportPreview',
      (postData) => ({
        data: {
          customReportPreview: richPreviewResult(configFromVariables(postData.variables ?? {})),
        },
      }),
    ],
  ])
  await page.goto('/reports/builder', { timeout: 120_000 })
  await expect(page.getByRole('heading', { name: 'Custom report builder' })).toBeVisible({
    timeout: 60_000,
  })
  await page.getByRole('button', { name: /Deals/ }).click()
  // Wait for the field catalogue to hydrate the palette buttons.
  await expect(page.getByRole('button', { name: 'Add Stage as dimension' })).toBeVisible({
    timeout: 15_000,
  })
}

const CHART_SELECTOR_OPTIONS = [
  'Table',
  'Line Chart',
  'Bar Chart',
  'Pie Chart',
  'Donut Chart',
  'Area Chart',
  'Funnel Chart',
  'Scatter Plot',
  'Heatmap',
]

test('chart selector: 9 labelled options, selection state, static previews fire no requests (AC 4, 17)', async ({
  page,
}) => {
  let previewRequestCount = 0
  await openBuilderWithDeals(page, [
    [
      'query CustomReportPreview',
      () => {
        previewRequestCount += 1
        return {
          data: {
            customReportPreview: {
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
        }
      },
    ],
  ])

  // All nine labelled options are visible (Table + the eight charts).
  for (const label of CHART_SELECTOR_OPTIONS) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  // Each option renders a static inline SVG preview (AC 17).
  await expect(page.locator('[data-testid^="chart-preview-"]')).toHaveCount(9)
  await expect(page.locator('[data-testid^="chart-preview-"] svg')).toHaveCount(9)

  // Clicking moves the selected (aria-pressed) state.
  for (const label of CHART_SELECTOR_OPTIONS) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }

  // The previews are decorative/static: with no fields configured the draft is
  // not previewable, so clicking through the selector must fire zero preview
  // requests (AC 17 — previews never trigger GraphQL).
  expect(previewRequestCount).toBe(0)
})

test('choosing compatible chart types renders each live preview (AC 4)', async ({ page }) => {
  await openBuilderWithDeals(page)
  await page.getByRole('button', { name: 'Add Stage as dimension' }).click()
  await page.getByRole('button', { name: 'Add Value as metric' }).click()

  // BAR, PIE, DONUT and FUNNEL are all compatible with [Stage, Value SUM] —
  // each selection must re-render the framework chart with its own type.
  const chartCases = [
    ['Bar Chart', 'BAR Chart'],
    ['Pie Chart', 'PIE Chart'],
    ['Donut Chart', 'DONUT Chart'],
    ['Funnel Chart', 'FUNNEL Chart'],
  ] as const

  for (const [optionLabel, chartAriaLabel] of chartCases) {
    await page.getByRole('button', { name: optionLabel, exact: true }).click()
    // aria-label = chart title (null) → "<TYPE> Chart" on the figure.
    await expect(page.getByRole('img', { name: chartAriaLabel, exact: true })).toBeVisible({
      timeout: 15_000,
    })
  }
})

test('legend toggles series per chart and never hides all (AC 12)', async ({ page }) => {
  await openBuilderWithDeals(page)
  await page.getByRole('button', { name: 'Add Stage as dimension' }).click()
  // Two different metric fields → two legend series (Value SUM, Deal ID COUNT).
  await page.getByRole('button', { name: 'Add Value as metric' }).click()
  await page.getByRole('button', { name: 'Add Deal ID as metric' }).click()
  await page.getByRole('button', { name: 'Bar Chart', exact: true }).click()

  const figure = page.getByTestId('report-chart-container')
  await expect(figure).toBeVisible()
  const legendButtons = figure.getByRole('button', { name: /^Toggle series / })
  await expect(legendButtons).toHaveCount(2)

  // 6 stages × 2 series = 12 rendered bars.
  await expect(figure.locator('g.recharts-bar-rectangle')).toHaveCount(12)

  // Hide the second series → its button flips to aria-pressed=false and only
  // one series of bars remains.
  await legendButtons.nth(1).click()
  await expect(legendButtons.nth(1)).toHaveAttribute('aria-pressed', 'false')
  await expect(figure.locator('g.recharts-bar-rectangle')).toHaveCount(6)

  // Never hide all (Contract C.17): with one series left the remaining toggle
  // is blocked and its bars stay visible.
  await legendButtons.nth(0).click()
  await expect(legendButtons.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(figure.locator('g.recharts-bar-rectangle')).toHaveCount(6)

  // Re-showing the hidden series restores both series.
  await legendButtons.nth(1).click()
  await expect(legendButtons.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(figure.locator('g.recharts-bar-rectangle')).toHaveCount(12)
})

test('zoom and pan move the visible point window, reset restores it (AC 12, Contract D.20)', async ({
  page,
}) => {
  await openBuilderWithDeals(page)
  // LINE over a MONTH-granularity date dimension → 40-point fixture exercises
  // the 30-point default window.
  await page.getByRole('button', { name: 'Add Created at as dimension' }).click()
  await page.getByLabel('Granularity for Created at').selectOption('MONTH')
  await page.getByRole('button', { name: 'Add Value as metric' }).click()
  await page.getByRole('button', { name: 'Line Chart', exact: true }).click()

  const rangeSummary = page.getByTestId('viewport-range-summary')
  await expect(rangeSummary).toHaveText('Showing points 1–30 of 40')

  // Zoom in shrinks the window (30 → 21), anchored at the start.
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(rangeSummary).toHaveText('Showing points 1–21 of 40')

  // Pan next shifts the window by 30% of its size (6) without reordering.
  await page.getByRole('button', { name: 'Pan next' }).click()
  await expect(rangeSummary).toHaveText('Showing points 7–27 of 40')
  await page.getByRole('button', { name: 'Pan next' }).click()
  await expect(rangeSummary).toHaveText('Showing points 13–33 of 40')

  // Pan previous walks back.
  await page.getByRole('button', { name: 'Pan previous' }).click()
  await expect(rangeSummary).toHaveText('Showing points 7–27 of 40')

  // Reset restores the full default window.
  await page.getByRole('button', { name: 'Reset zoom and pan' }).click()
  await expect(rangeSummary).toHaveText('Showing points 1–30 of 40')
})

test('drill-down opens the accessible Sheet with contributing records (AC 15, Contract E.29)', async ({
  page,
}) => {
  await openBuilderWithDeals(page, [
    [
      'query CustomReportDrillDown',
      () => ({
        data: {
          customReportDrillDown: {
            source: 'DEALS',
            pointLabel: 'Proposal',
            items: [
              {
                id: 'deal-1',
                primaryLabel: 'Acme Corp',
                secondaryLabel: '12,000 · Proposal',
                relatedRecordId: 'deal-1',
              },
              {
                id: 'deal-2',
                primaryLabel: 'Globex Industries',
                secondaryLabel: '24,000 · Proposal',
                relatedRecordId: 'deal-2',
              },
            ],
            total: 2,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          },
        },
      }),
    ],
  ])
  await page.getByRole('button', { name: 'Add Stage as dimension' }).click()
  await page.getByRole('button', { name: 'Add Value as metric' }).click()
  await page.getByRole('button', { name: 'Bar Chart', exact: true }).click()

  const figure = page.getByTestId('report-chart-container')
  await expect(figure).toBeVisible()

  // Keyboard-accessible drill equivalent (the chart is never the only path).
  await figure.getByRole('button', { name: 'Proposal', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Underlying Records' })).toBeVisible()
  await expect(page.getByText('Records for Proposal')).toBeVisible()
  await expect(dialog.getByText('Acme Corp')).toBeVisible()
  await expect(dialog.getByText('Globex Industries')).toBeVisible()
  // DEALS records link to their shipped detail route.
  await expect(dialog.getByRole('link', { name: 'View' }).first()).toHaveAttribute(
    'href',
    '/deals/deal-1',
  )

  // Escape closes the Sheet (focus returns to the trigger per Contract E.29).
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible({ timeout: 5_000 })
})

test('PNG/SVG export downloads non-empty files with correct MIME signature (AC 12, Contract D.22-24)', async ({
  page,
}) => {
  await openBuilderWithDeals(page)
  await page.getByRole('button', { name: 'Add Stage as dimension' }).click()
  await page.getByRole('button', { name: 'Add Value as metric' }).click()
  // A deterministic title drives the export filename.
  await page.getByLabel('Chart title').fill('Revenue by stage')
  await page.getByRole('button', { name: 'Bar Chart', exact: true }).click()

  const figure = page.getByTestId('report-chart-container')
  await expect(figure).toBeVisible()
  await expect(figure.getByTestId('chart-title')).toHaveText('Revenue by stage')

  // ── SVG export ──────────────────────────────────────────────────────────
  const svgDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export as SVG' }).click()
  const svgDownload = await svgDownloadPromise
  expect(svgDownload.suggestedFilename()).toBe('revenue-by-stage-bar.svg')
  const svgPath = await svgDownload.path()
  expect(svgPath).toBeTruthy()
  const svgContent = readFileSync(svgPath!, 'utf-8')
  // Non-empty, real SVG: XML namespace, opaque background rect, exported title.
  expect(svgContent.length).toBeGreaterThan(1000)
  expect(svgContent).toContain('<svg')
  expect(svgContent).toContain('xmlns="http://www.w3.org/2000/svg"')
  expect(svgContent).toContain('<rect')
  expect(svgContent).toContain('<title>Revenue by stage</title>')

  // ── PNG export ──────────────────────────────────────────────────────────
  const pngDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export as PNG' }).click()
  const pngDownload = await pngDownloadPromise
  expect(pngDownload.suggestedFilename()).toBe('revenue-by-stage-bar.png')
  const pngPath = await pngDownload.path()
  expect(pngPath).toBeTruthy()
  const pngBytes = readFileSync(pngPath!)
  // Non-empty with the PNG magic signature (89 50 4E 47 0D 0A 1A 0A).
  expect(pngBytes.length).toBeGreaterThan(1000)
  expect(pngBytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )
})
