/**
 * Story 6.3 & 6.4 — frontend-unit (web lib) spec: client-side draft reducer,
 * server-equivalent validation gating, chart compatibility and safe
 * expression diagnostics. Mirrors the test plan's `custom-report-builder`
 * tier.
 */
import {
  CHART_LABELS,
  CUSTOM_REPORT_CHART_TYPES,
  CUSTOM_REPORT_COLOR_TOKENS,
  CUSTOM_REPORT_DEFAULT_COLORS,
  CUSTOM_REPORT_LEGEND_POSITIONS,
  chartCompatibilityErrors,
  clearSourceSelections,
  configToDraft,
  createEmptyDraft,
  customReportDraftReducer,
  defaultVisualization,
  draftHasSelections,
  expressionDiagnostics,
  serializeConfig,
  validateDraft,
} from '../custom-report-builder'
import type {
  CustomReportCatalog,
  CustomReportConfig,
  CustomReportDraft,
  CustomReportField,
} from '../custom-report-builder'

// ─── Fixtures ──────────────────────────────────────────────────────────

const DEAL_FIELDS: CustomReportField[] = [
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
    filterOperators: ['ON', 'BEFORE', 'AFTER', 'BETWEEN'],
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
    roles: ['FILTER', 'DIMENSION'],
    aggregations: [],
    filterOperators: ['EQ', 'NOT_EQ', 'IN'],
    relationKind: null,
    isNumeric: false,
    isCurrency: false,
    isDate: false,
  },
  {
    key: 'deal.value',
    label: 'Value',
    valueType: 'CURRENCY',
    roles: ['FILTER', 'METRIC'],
    aggregations: ['SUM', 'AVERAGE', 'MIN', 'MAX'],
    filterOperators: ['EQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN'],
    relationKind: null,
    isNumeric: true,
    isCurrency: true,
    isDate: false,
  },
  {
    key: 'deal.probability',
    label: 'Probability',
    valueType: 'NUMBER',
    roles: ['FILTER', 'METRIC'],
    aggregations: ['AVERAGE', 'MIN', 'MAX'],
    filterOperators: ['EQ', 'GT', 'GTE', 'LT', 'LTE'],
    relationKind: null,
    isNumeric: true,
    isCurrency: false,
    isDate: false,
  },
]

const DEALS_CATALOG: CustomReportCatalog = {
  dataSource: 'DEALS',
  fields: DEAL_FIELDS,
}

function validDraft(): CustomReportDraft {
  return {
    source: 'DEALS',
    filters: [],
    dimensions: [
      { id: 'dim-1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
    ],
    metrics: [
      { id: 'met-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
      { id: 'met-2', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
    ],
    calculatedFields: [],
    visualization: {
      type: 'TABLE',
      title: 'Revenue by month',
      showLegend: true,
      showDataLabels: false,
      xAxisLabel: null,
      yAxisLabel: null,
      orientation: null,
      colors: [...CUSTOM_REPORT_DEFAULT_COLORS],
      legendPosition: 'BOTTOM',
    },
    sort: [],
  }
}

describe('custom-report-builder lib (Story 6.4 v2 & compatibility)', () => {
  describe('constants & vocabularies (Contract A.1, A.2)', () => {
    it('exposes all 9 chart types and 4 legend positions', () => {
      expect(CUSTOM_REPORT_CHART_TYPES).toEqual([
        'TABLE',
        'LINE',
        'BAR',
        'PIE',
        'DONUT',
        'AREA',
        'FUNNEL',
        'SCATTER',
        'HEATMAP',
      ])
      expect(CUSTOM_REPORT_LEGEND_POSITIONS).toEqual(['TOP', 'RIGHT', 'BOTTOM', 'LEFT'])
      expect(CUSTOM_REPORT_COLOR_TOKENS).toHaveLength(10)
      expect(Object.keys(CHART_LABELS)).toHaveLength(9)
    })
  })

  describe('createEmptyDraft / draftHasSelections', () => {
    it('creates an empty draft with TABLE visualization and default colors/legendPosition', () => {
      const draft = createEmptyDraft()
      expect(draft.source).toBeNull()
      expect(draft.filters).toEqual([])
      expect(draft.dimensions).toEqual([])
      expect(draft.metrics).toEqual([])
      expect(draft.calculatedFields).toEqual([])
      expect(draft.sort).toEqual([])
      expect(draft.visualization.type).toBe('TABLE')
      expect(draft.visualization.legendPosition).toBe('BOTTOM')
      expect(draft.visualization.colors).toEqual(CUSTOM_REPORT_DEFAULT_COLORS)
      expect(draftHasSelections(draft)).toBe(false)
    })

    it('reports selections when any filter/dimension/metric/calculated/sort exists', () => {
      const draft = createEmptyDraft()
      expect(
        draftHasSelections({
          ...draft,
          filters: [
            {
              id: 'f1',
              fieldId: 'x',
              operator: 'EQ',
              stringValue: 'a',
              numberValue: null,
              booleanValue: null,
              dateValue: null,
              stringValues: null,
              numberValues: null,
              dateValues: null,
            },
          ],
        }),
      ).toBe(true)
      expect(
        draftHasSelections({
          ...draft,
          dimensions: [{ id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null }],
        }),
      ).toBe(true)
      expect(
        draftHasSelections({
          ...draft,
          metrics: [{ id: 'm1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' }],
        }),
      ).toBe(true)
      expect(
        draftHasSelections({
          ...draft,
          calculatedFields: [{ id: 'c1', alias: 'avg', label: null, expression: 'a / b' }],
        }),
      ).toBe(true)
      expect(
        draftHasSelections({ ...draft, sort: [{ id: 's1', targetId: 'met-1', direction: 'ASC' }] }),
      ).toBe(true)
    })
  })

  describe('clearSourceSelections', () => {
    it('clears filters/dimensions/metrics/calculated fields/sorts but keeps source + visualization', () => {
      const draft = validDraft()
      const cleared = clearSourceSelections(draft)
      expect(cleared.source).toBe('DEALS')
      expect(cleared.filters).toEqual([])
      expect(cleared.dimensions).toEqual([])
      expect(cleared.metrics).toEqual([])
      expect(cleared.calculatedFields).toEqual([])
      expect(cleared.sort).toEqual([])
      expect(cleared.visualization.type).toBe('TABLE')
    })
  })

  describe('serializeConfig / configToDraft (v2 normalization)', () => {
    it('returns null when the draft has no source', () => {
      const draft = { ...createEmptyDraft(), dimensions: validDraft().dimensions }
      expect(serializeConfig(draft)).toBeNull()
    })

    it('serializes a draft to a version 2 config with colors and legendPosition', () => {
      const draft = validDraft()
      draft.sort = [{ id: 'sort-1', targetId: 'met-2', direction: 'DESC' }]
      const config = serializeConfig(draft)
      expect(config).not.toBeNull()
      expect(config?.version).toBe(2)
      expect(config?.dataSource).toBe('DEALS')
      expect(config?.visualization.colors).toEqual(CUSTOM_REPORT_DEFAULT_COLORS)
      expect(config?.visualization.legendPosition).toBe('BOTTOM')
    })

    it('round-trips a saved config back into a draft with v2 defaults populated', () => {
      const draft = validDraft()
      const config = serializeConfig(draft) as CustomReportConfig
      const restored = configToDraft(config)
      expect(restored.source).toBe('DEALS')
      expect(restored.visualization.colors).toEqual(CUSTOM_REPORT_DEFAULT_COLORS)
      expect(restored.visualization.legendPosition).toBe('BOTTOM')
    })
  })

  describe('validateDraft (AC 15)', () => {
    it('accepts a valid draft and marks it previewable and saveable', () => {
      const result = validateDraft(validDraft(), DEALS_CATALOG)
      expect(result.saveable).toBe(true)
      expect(result.previewable).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('flags missing source as not previewable or saveable', () => {
      const empty = createEmptyDraft()
      const result = validateDraft(empty, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.previewable).toBe(false)
    })
  })

  describe('chartCompatibilityErrors (Contract A.4)', () => {
    it('accepts TABLE for any otherwise-valid config', () => {
      expect(chartCompatibilityErrors('TABLE', validDraft(), DEALS_CATALOG)).toEqual([])
    })

    it('handles AREA compatibility identically to LINE (date dimension first + numeric metric)', () => {
      const draft = validDraft()
      expect(chartCompatibilityErrors('AREA', draft, DEALS_CATALOG)).toEqual([])
      draft.dimensions[0] = {
        id: 'dim-1',
        fieldId: 'deal.stage',
        calculation: null,
        granularity: null,
      }
      expect(chartCompatibilityErrors('AREA', draft, DEALS_CATALOG).join(' ')).toContain('date')
    })

    it('handles DONUT compatibility identically to PIE (exactly 1 dimension and 1 numeric metric)', () => {
      const draft = validDraft()
      expect(chartCompatibilityErrors('DONUT', draft, DEALS_CATALOG).length).toBeGreaterThan(0)
      draft.dimensions = [{ id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null }]
      draft.metrics = [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }]
      expect(chartCompatibilityErrors('DONUT', draft, DEALS_CATALOG)).toEqual([])

      // Supports calculated field as the single numeric metric
      draft.metrics = []
      draft.calculatedFields = [{ id: 'c1', alias: 'avg_rev', label: 'Avg Rev', expression: '100' }]
      expect(chartCompatibilityErrors('DONUT', draft, DEALS_CATALOG)).toEqual([])
      expect(chartCompatibilityErrors('PIE', draft, DEALS_CATALOG)).toEqual([])

      // Rejects when 1 base metric + 1 calculated field (total > 1)
      draft.metrics = [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }]
      expect(chartCompatibilityErrors('DONUT', draft, DEALS_CATALOG).length).toBeGreaterThan(0)
    })

    it('validates SCATTER: 1 dimension and exactly 2 numeric metrics', () => {
      const draft = validDraft()
      draft.dimensions = [{ id: 'd1', fieldId: 'deal.id', calculation: null, granularity: null }]
      draft.metrics = [
        { id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
        { id: 'm2', fieldId: 'deal.probability', aggregation: 'AVERAGE', alias: 'prob' },
      ]
      expect(chartCompatibilityErrors('SCATTER', draft, DEALS_CATALOG)).toEqual([])

      // Supports calculated field as one of the 2 metrics
      draft.metrics = [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }]
      draft.calculatedFields = [
        { id: 'c1', alias: 'margin', label: 'Margin', expression: 'revenue * 0.2' },
      ]
      expect(chartCompatibilityErrors('SCATTER', draft, DEALS_CATALOG)).toEqual([])

      // Invalid: 2 dimensions
      draft.dimensions.push({
        id: 'd2',
        fieldId: 'deal.stage',
        calculation: null,
        granularity: null,
      })
      expect(chartCompatibilityErrors('SCATTER', draft, DEALS_CATALOG).join(' ')).toContain(
        'one identifying dimension',
      )

      // Invalid: 1 metric
      draft.dimensions = [{ id: 'd1', fieldId: 'deal.id', calculation: null, granularity: null }]
      draft.metrics = [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }]
      draft.calculatedFields = []
      expect(chartCompatibilityErrors('SCATTER', draft, DEALS_CATALOG).join(' ')).toContain(
        'two numeric metrics',
      )
    })

    it('validates HEATMAP: exactly 2 dimensions and exactly 1 numeric metric', () => {
      const draft = validDraft()
      draft.dimensions = [
        { id: 'd1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
        { id: 'd2', fieldId: 'deal.stage', calculation: null, granularity: null },
      ]
      draft.metrics = [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }]
      expect(chartCompatibilityErrors('HEATMAP', draft, DEALS_CATALOG)).toEqual([])

      // Supports calculated field as the single numeric metric
      draft.metrics = []
      draft.calculatedFields = [{ id: 'c1', alias: 'margin', label: 'Margin', expression: '100' }]
      expect(chartCompatibilityErrors('HEATMAP', draft, DEALS_CATALOG)).toEqual([])

      // Invalid: 1 dimension
      draft.dimensions = [
        { id: 'd1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
      ]
      expect(chartCompatibilityErrors('HEATMAP', draft, DEALS_CATALOG).join(' ')).toContain(
        'two dimensions',
      )
    })

    it('validates FUNNEL: 1 stage dimension, Deals source, and 1 COUNT/SUM metric (base or calculated)', () => {
      const draft = validDraft()
      draft.source = 'DEALS'
      draft.dimensions = [{ id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null }]
      draft.metrics = [{ id: 'm1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'count' }]
      expect(chartCompatibilityErrors('FUNNEL', draft, DEALS_CATALOG)).toEqual([])

      // Supports calculated field as metric
      draft.metrics = []
      draft.calculatedFields = [{ id: 'c1', alias: 'calc_count', label: 'Calc', expression: '10' }]
      expect(chartCompatibilityErrors('FUNNEL', draft, DEALS_CATALOG)).toEqual([])
    })
  })

  describe('expressionDiagnostics (Contract A.8)', () => {
    it('validates mathematical expressions without execution', () => {
      expect(expressionDiagnostics('revenue / deals', ['revenue', 'deals']).error).toBeNull()
      expect(expressionDiagnostics('revenue / 0', ['revenue']).warning).toContain('zero')
      expect(expressionDiagnostics('unknown + 1', ['revenue']).error).toContain('unknown')
    })
  })

  describe('customReportDraftReducer', () => {
    it('SET_CHART_TYPE updates chart type and manages orientation cleanly', () => {
      const state = customReportDraftReducer(validDraft(), {
        type: 'SET_CHART_TYPE',
        chartType: 'BAR',
      })
      expect(state.visualization.type).toBe('BAR')
      expect(state.visualization.orientation).toBe('VERTICAL')

      const scatter = customReportDraftReducer(state, {
        type: 'SET_CHART_TYPE',
        chartType: 'SCATTER',
      })
      expect(scatter.visualization.type).toBe('SCATTER')
      expect(scatter.visualization.orientation).toBeNull()
    })

    it('UPDATE_VISUALIZATION allows patching colors and legendPosition', () => {
      const state = customReportDraftReducer(validDraft(), {
        type: 'UPDATE_VISUALIZATION',
        patch: {
          legendPosition: 'RIGHT',
          colors: ['VIOLET', 'AMBER'],
        },
      })
      expect(state.visualization.legendPosition).toBe('RIGHT')
      expect(state.visualization.colors).toEqual(['VIOLET', 'AMBER'])
    })

    it('RESET returns default visualization', () => {
      const state = customReportDraftReducer(validDraft(), { type: 'RESET' })
      expect(state.visualization).toEqual(defaultVisualization())
    })
  })
})
