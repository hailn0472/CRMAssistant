import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { applyAuthCookie } from '../support/helpers/auth'

// ---------------------------------------------------------------------------
// Story 6.4 — Contract G.40 / Binding AC 19 (Critical finding C1).
//
// Deterministic visual-regression baselines for all EIGHT chart types
// (LINE, BAR, PIE, DONUT, AREA, FUNNEL, SCATTER, HEATMAP) rendered through the
// real Recharts-based ReportChart framework in the custom-report builder.
//
// Technique (same as the Story 6.3 builder E2E): GraphQL is route-mocked at
// `**/api/graphql` with coherent config-derived data, so the web app runs
// standalone. Unlike the workflow spec, this spec drives the builder through
// its EDIT route (`/reports/builder?reportId=vr-<type>`): mocking
// `query CustomReportData` seeds the draft directly from a deterministic v2
// config, and `query CustomReportPreview` returns the same rich multi-series
// fixture. No clicks, no debounce variance — the chart appears as soon as the
// (mocked) preview resolves.
//
// Determinism contract (G.40):
//  - fixed viewport (1280×900), DPR 1, en-US locale, UTC timezone
//  - fixed `generatedAt` (also the dataset identity) and fixed fixture values
//  - `prefers-reduced-motion: reduce` (Recharts 3.10.1 disables its JS
//    animation engine under reduced motion) + CSS transitions/animations/
//    carets disabled via injected style
//  - waits for `document.fonts.ready` and for the chart SVG markup to become
//    stable (two identical consecutive samples)
//
// Baselines: `tests/e2e/report-chart-visual-regression.spec.ts-snapshots/`
// (Linux Chromium PNGs, committed at Stage 10). Generate once with
// `--update-snapshots`, then CI compares with `maxDiffPixelRatio: 0.01`
// (documented small tolerance for sub-pixel antialiasing; real regressions
// exceed it). CI must NEVER run with `--update-snapshots`.
// ---------------------------------------------------------------------------

// The web dev server signs/verifies JWTs with the Infisical-injected
// JWT_SECRET (same secret the API uses), NOT the Playwright default — sign the
// auth cookie with that secret or the middleware redirects to /login.
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'

const FIXED_GENERATED_AT = '2026-08-16T12:00:00.000Z'

type ChartType = 'LINE' | 'BAR' | 'PIE' | 'DONUT' | 'AREA' | 'FUNNEL' | 'SCATTER' | 'HEATMAP'

const CHART_TYPES: readonly ChartType[] = [
  'LINE',
  'BAR',
  'PIE',
  'DONUT',
  'AREA',
  'FUNNEL',
  'SCATTER',
  'HEATMAP',
]

type MockHandler = (postData: {
  query: string
  variables?: Record<string, unknown>
}) => { data: unknown } | Promise<{ data: unknown }>

async function setupGraphqlMock(page: Page, handlers: Array<[string, MockHandler]>): Promise<void> {
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

// ─── DEALS catalogue (mirror of apps/api/src/reports/custom-report-catalog.ts) ───

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

const FIELD_BY_KEY = new Map(DEALS_CATALOG.fields.map((f) => [f.key, f]))

// ─── Deterministic fixture data (fixed values → fixed pixels) ─────────────

const MONTHS = [
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
  '2026-12',
]

const LINE_REVENUE = [4200, 4650, 5100, 4800, 5300, 5900, 6200, 5750, 6400, 6900, 7350, 7800]
const LINE_AVG = [21.4, 22.1, 22.8, 21.9, 23.2, 24.0, 24.6, 23.8, 24.9, 25.5, 26.1, 26.8]
const LINE_COUNT = [196, 210, 224, 219, 228, 246, 252, 242, 257, 271, 282, 291]

const STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']
const BAR_REVENUE = [12000, 18500, 24000, 15200, 42800, 6100]
const BAR_AVG = [8.5, 12.4, 15.8, 11.2, 28.6, 4.2]

const PIE_LABELS = ['Proposal', 'Negotiation', 'Closed Won', 'Qualified', 'New']
const PIE_VALUES = [42, 26, 18, 9, 5]

const FUNNEL_LABELS = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won']
const FUNNEL_VALUES = [500, 320, 180, 95, 42]

const SCATTER_X = [12.5, 18.2, 25.0, 9.8, 32.4, 21.1, 15.6, 28.9, 11.4, 24.7, 19.3, 30.2]
const SCATTER_Y = [8.2, 9.1, 11.5, 6.4, 14.2, 10.3, 8.9, 12.8, 7.1, 11.9, 9.8, 13.4]

const HEATMAP_X = ['New', 'Qualified', 'Proposal']
const HEATMAP_Y = ['OPEN', 'WON', 'LOST', 'PAUSED']

// ─── Config / result builders (coherent, one-writer rule) ─────────────────

interface DimSpec {
  id: string
  fieldId: string
  granularity: string | null
}

interface MetricSpec {
  id: string
  fieldId: string
  aggregation: string
  alias: string
}

interface V2Config {
  version: number
  dataSource: string
  filters: unknown[]
  dimensions: DimSpec[]
  metrics: MetricSpec[]
  calculatedFields: unknown[]
  visualization: {
    type: ChartType
    title: string
    showLegend: boolean
    showDataLabels: boolean
    xAxisLabel: string | null
    yAxisLabel: string | null
    orientation: string | null
    colors: string[]
    legendPosition: string
  }
  sort: unknown[]
}

function configFor(type: ChartType, dimensions: DimSpec[], metrics: MetricSpec[]): V2Config {
  return {
    version: 2,
    dataSource: 'DEALS',
    filters: [],
    dimensions,
    metrics,
    calculatedFields: [],
    visualization: {
      type,
      title: `Visual regression ${type}`,
      showLegend: true,
      // PIE/DONUT render percentage-ish value labels (AC 7).
      showDataLabels: type === 'PIE' || type === 'DONUT',
      xAxisLabel: null,
      yAxisLabel: null,
      // Orientation is a BAR-only option — every other type must carry null.
      orientation: type === 'BAR' ? 'VERTICAL' : null,
      colors: ['BLUE', 'VIOLET', 'GREEN', 'AMBER', 'RED', 'CYAN', 'PINK', 'LIME', 'INDIGO', 'TEAL'],
      legendPosition: 'BOTTOM',
    },
    sort: [],
  }
}

interface SeriesPoint {
  key: string
  label: string
  value: number | null
  dimensionLabels: string[]
}

interface ResultSeries {
  metricId: string
  label: string
  points: SeriesPoint[]
}

interface PreviewResult {
  reportId: string | null
  generatedAt: string
  config: V2Config
  columns: unknown[]
  rows: unknown[]
  totalRows: number
  series: ResultSeries[]
  warnings: unknown[]
  pagination: { page: number; pageSize: number; totalPages: number }
  truncated: boolean
}

function columnForDim(d: DimSpec): unknown {
  const field = FIELD_BY_KEY.get(d.fieldId)
  return {
    fieldId: d.fieldId,
    label: field?.label ?? d.fieldId,
    valueType: field?.valueType ?? 'STRING',
    role: 'DIMENSION',
    aggregation: null,
    granularity: d.granularity,
    isCalculated: false,
  }
}

function columnForMetric(m: MetricSpec): unknown {
  const field = FIELD_BY_KEY.get(m.fieldId)
  return {
    fieldId: m.fieldId,
    label: field?.label ?? m.fieldId,
    valueType: field?.valueType ?? 'NUMBER',
    role: 'METRIC',
    aggregation: m.aggregation,
    granularity: null,
    isCalculated: false,
  }
}

function sampleRows(config: V2Config, firstPoint: SeriesPoint): unknown[] {
  const dimCell = (d: DimSpec): unknown => ({
    fieldId: d.fieldId,
    label: FIELD_BY_KEY.get(d.fieldId)?.label ?? d.fieldId,
    valueType: FIELD_BY_KEY.get(d.fieldId)?.valueType ?? 'STRING',
    stringValue: firstPoint.dimensionLabels[0] ?? firstPoint.label,
    numberValue: null,
    booleanValue: null,
    dateValue: null,
    isNull: false,
  })
  const metricCell = (m: MetricSpec): unknown => ({
    fieldId: m.fieldId,
    label: FIELD_BY_KEY.get(m.fieldId)?.label ?? m.fieldId,
    valueType: FIELD_BY_KEY.get(m.fieldId)?.valueType ?? 'NUMBER',
    stringValue: null,
    numberValue: firstPoint.value,
    booleanValue: null,
    dateValue: null,
    isNull: false,
  })
  // The preview panel renders the chart only when rows are non-empty — the
  // table slice stays paginated while the chart series cover the full bounds.
  return [
    {
      key: `row-${firstPoint.key}`,
      cells: [...config.dimensions.map(dimCell), ...config.metrics.map(metricCell)],
    },
  ]
}

function resultFor(
  reportId: string,
  config: V2Config,
  series: ResultSeries[],
  rows: unknown[],
): PreviewResult {
  return {
    reportId,
    generatedAt: FIXED_GENERATED_AT,
    config,
    columns: [...config.dimensions.map(columnForDim), ...config.metrics.map(columnForMetric)],
    rows,
    totalRows: rows.length,
    series,
    warnings: [],
    pagination: { page: 1, pageSize: 50, totalPages: 1 },
    truncated: false,
  }
}

// ─── Per-chart fixtures ───────────────────────────────────────────────────

function lineFixture(): PreviewResult {
  const config = configFor(
    'LINE',
    [{ id: 'dim-date', fieldId: 'deal.createdAt', granularity: 'MONTH' }],
    [
      { id: 'metric-rev', fieldId: 'deal.value', aggregation: 'SUM', alias: 'Revenue' },
      { id: 'metric-avg', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'Avg deal' },
      { id: 'metric-cnt', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'Deal count' },
    ],
  )
  const series: ResultSeries[] = [
    {
      metricId: 'metric-rev',
      label: 'Revenue',
      points: MONTHS.map((m, i) => ({
        key: `p-${i}`,
        label: m,
        value: LINE_REVENUE[i]!,
        dimensionLabels: [m],
      })),
    },
    {
      metricId: 'metric-avg',
      label: 'Avg deal',
      points: MONTHS.map((m, i) => ({
        key: `p-${i}`,
        label: m,
        value: LINE_AVG[i]!,
        dimensionLabels: [m],
      })),
    },
    {
      metricId: 'metric-cnt',
      label: 'Deal count',
      points: MONTHS.map((m, i) => ({
        key: `p-${i}`,
        label: m,
        value: LINE_COUNT[i]!,
        dimensionLabels: [m],
      })),
    },
  ]
  return resultFor('vr-line', config, series, sampleRows(config, series[0]!.points[0]!))
}

function barFixture(): PreviewResult {
  const config = configFor(
    'BAR',
    [{ id: 'dim-stage', fieldId: 'deal.stage', granularity: null }],
    [
      { id: 'metric-rev', fieldId: 'deal.value', aggregation: 'SUM', alias: 'Revenue' },
      { id: 'metric-avg', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'Avg deal' },
    ],
  )
  const series: ResultSeries[] = [
    {
      metricId: 'metric-rev',
      label: 'Revenue',
      points: STAGES.map((s, i) => ({
        key: `s-${i}`,
        label: s,
        value: BAR_REVENUE[i]!,
        dimensionLabels: [s],
      })),
    },
    {
      metricId: 'metric-avg',
      label: 'Avg deal',
      points: STAGES.map((s, i) => ({
        key: `s-${i}`,
        label: s,
        value: BAR_AVG[i]!,
        dimensionLabels: [s],
      })),
    },
  ]
  return resultFor('vr-bar', config, series, sampleRows(config, series[0]!.points[0]!))
}

function pieFixture(type: 'PIE' | 'DONUT'): PreviewResult {
  const config = configFor(
    type,
    [{ id: 'dim-stage', fieldId: 'deal.stage', granularity: null }],
    [{ id: 'metric-rev', fieldId: 'deal.value', aggregation: 'SUM', alias: 'Revenue' }],
  )
  const series: ResultSeries[] = [
    {
      metricId: 'metric-rev',
      label: 'Revenue',
      points: PIE_LABELS.map((label, i) => ({
        key: `slice-${i}`,
        label,
        value: PIE_VALUES[i]!,
        dimensionLabels: [label],
      })),
    },
  ]
  return resultFor(
    `vr-${type.toLowerCase()}`,
    config,
    series,
    sampleRows(config, series[0]!.points[0]!),
  )
}

function areaFixture(): PreviewResult {
  const config = configFor(
    'AREA',
    [{ id: 'dim-date', fieldId: 'deal.createdAt', granularity: 'MONTH' }],
    [
      { id: 'metric-rev', fieldId: 'deal.value', aggregation: 'SUM', alias: 'Revenue' },
      { id: 'metric-avg', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'Avg deal' },
    ],
  )
  const months = MONTHS.slice(0, 10)
  const series: ResultSeries[] = [
    {
      metricId: 'metric-rev',
      label: 'Revenue',
      points: months.map((m, i) => ({
        key: `p-${i}`,
        label: m,
        value: LINE_REVENUE[i]!,
        dimensionLabels: [m],
      })),
    },
    {
      metricId: 'metric-avg',
      label: 'Avg deal',
      points: months.map((m, i) => ({
        key: `p-${i}`,
        label: m,
        value: LINE_AVG[i]!,
        dimensionLabels: [m],
      })),
    },
  ]
  return resultFor('vr-area', config, series, sampleRows(config, series[0]!.points[0]!))
}

function funnelFixture(): PreviewResult {
  const config = configFor(
    'FUNNEL',
    [{ id: 'dim-stage', fieldId: 'deal.stage', granularity: null }],
    [{ id: 'metric-cnt', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'Deal count' }],
  )
  const series: ResultSeries[] = [
    {
      metricId: 'metric-cnt',
      label: 'Deal count',
      points: FUNNEL_LABELS.map((label, i) => ({
        key: `stage-${i}`,
        label,
        value: FUNNEL_VALUES[i]!,
        dimensionLabels: [label],
      })),
    },
  ]
  return resultFor('vr-funnel', config, series, sampleRows(config, series[0]!.points[0]!))
}

function scatterFixture(): PreviewResult {
  const config = configFor(
    'SCATTER',
    [{ id: 'dim-stage', fieldId: 'deal.stage', granularity: null }],
    [
      { id: 'metric-x', fieldId: 'deal.value', aggregation: 'SUM', alias: 'Deal value' },
      { id: 'metric-y', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'Avg value' },
    ],
  )
  const series: ResultSeries[] = [
    {
      metricId: 'metric-x',
      label: 'Deal value',
      points: SCATTER_X.map((v, i) => {
        const label = `Deal ${String(i + 1).padStart(2, '0')}`
        return { key: `pt-${i}`, label, value: v, dimensionLabels: [label] }
      }),
    },
    {
      metricId: 'metric-y',
      label: 'Avg value',
      points: SCATTER_Y.map((v, i) => {
        const label = `Deal ${String(i + 1).padStart(2, '0')}`
        return { key: `pt-${i}`, label, value: v, dimensionLabels: [label] }
      }),
    },
  ]
  return resultFor('vr-scatter', config, series, sampleRows(config, series[0]!.points[0]!))
}

function heatmapFixture(): PreviewResult {
  const config = configFor(
    'HEATMAP',
    [
      { id: 'dim-stage', fieldId: 'deal.stage', granularity: null },
      { id: 'dim-status', fieldId: 'deal.status', granularity: null },
    ],
    [{ id: 'metric-rev', fieldId: 'deal.value', aggregation: 'SUM', alias: 'Revenue' }],
  )
  const points: SeriesPoint[] = []
  for (let x = 0; x < HEATMAP_X.length; x++) {
    for (let y = 0; y < HEATMAP_Y.length; y++) {
      const xLabel = HEATMAP_X[x]!
      const yLabel = HEATMAP_Y[y]!
      points.push({
        key: `cell-${x}-${y}`,
        label: `${xLabel} × ${yLabel}`,
        value: 10 + x * 8 + y * 5,
        dimensionLabels: [xLabel, yLabel],
      })
    }
  }
  const series: ResultSeries[] = [{ metricId: 'metric-rev', label: 'Revenue', points }]
  return resultFor('vr-heatmap', config, series, sampleRows(config, series[0]!.points[0]!))
}

function fixtureFor(type: ChartType): PreviewResult {
  switch (type) {
    case 'LINE':
      return lineFixture()
    case 'BAR':
      return barFixture()
    case 'PIE':
      return pieFixture('PIE')
    case 'DONUT':
      return pieFixture('DONUT')
    case 'AREA':
      return areaFixture()
    case 'FUNNEL':
      return funnelFixture()
    case 'SCATTER':
      return scatterFixture()
    case 'HEATMAP':
      return heatmapFixture()
  }
}

// ─── Stability helpers ────────────────────────────────────────────────────

/**
 * Wait until the framework chart is pixel-stable: fonts loaded, the Recharts
 * SVG present, and its serialized markup identical across two consecutive
 * samples (animations are already disabled via reduced-motion + injected CSS).
 */
async function waitForChartStability(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  const svg = page.locator('svg.recharts-surface').first()
  await expect(svg).toBeVisible({ timeout: 30_000 })
  let previous: string | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(350)
    const current = await svg.evaluate((el) => el.outerHTML)
    if (previous !== null && current === previous) return
    previous = current
  }
}

test.use({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
})

test.beforeEach(async ({ context, page }) => {
  // Sign the auth cookie with the secret the web server actually accepts.
  process.env['JWT_SECRET'] = API_JWT_SECRET
  await applyAuthCookie(context)
  // Recharts 3.10.1 disables its JS animation engine under reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Belt and braces: no CSS transitions/animations, no visible caret.
  await page.addStyleTag({
    content:
      '* { transition: none !important; animation: none !important; caret-color: transparent !important; }',
  })
})

test.afterEach(() => {
  // Unset to avoid leaking the Infisical secret to other specs in this worker.
  delete process.env['JWT_SECRET']
})

for (const type of CHART_TYPES) {
  test(`renders a deterministic ${type} chart baseline (AC 19 / Contract G.40)`, async ({
    page,
  }) => {
    const fixture = fixtureFor(type)

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
      ['query CustomReportData', () => ({ data: { customReportData: fixture } })],
      ['query CustomReportPreview', () => ({ data: { customReportPreview: fixture } })],
    ])

    // Edit mode seeds the draft from the deterministic saved config — the
    // chart appears without any builder clicks.
    await page.goto(`/reports/builder?reportId=vr-${type.toLowerCase()}`, { timeout: 120_000 })

    const figure = page.getByTestId('report-chart-container')
    await expect(figure).toBeVisible({ timeout: 60_000 })
    // Prove the RIGHT chart type rendered (aria-label = config title), then
    // wait for fonts + SVG stability before capturing pixels.
    await expect(
      page.getByRole('img', { name: `Visual regression ${type}`, exact: true }),
    ).toBeVisible()
    await waitForChartStability(page)

    await expect(figure).toHaveScreenshot(`chart-${type.toLowerCase()}.png`, {
      animations: 'disabled',
      // Documented small tolerance: absorbs sub-pixel antialiasing drift
      // between Linux Chromium builds while still failing on real regressions.
      maxDiffPixelRatio: 0.01,
      timeout: 30_000,
    })
  })
}
