/**
 * Story 6.3 — frontend-unit (web lib) spec: client-side draft reducer,
 * server-equivalent validation gating, chart compatibility and safe
 * expression diagnostics. Mirrors the test plan's `custom-report-builder`
 * tier (AC 5, 9, 13, 14, 15 + edge cases E6/E7).
 */
import {
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
    },
    sort: [],
  }
}

describe('custom-report-builder lib (AC 5, 9, 13-15)', () => {
  describe('createEmptyDraft / draftHasSelections', () => {
    it('creates an empty draft with TABLE visualization and no source', () => {
      const draft = createEmptyDraft()
      expect(draft.source).toBeNull()
      expect(draft.filters).toEqual([])
      expect(draft.dimensions).toEqual([])
      expect(draft.metrics).toEqual([])
      expect(draft.calculatedFields).toEqual([])
      expect(draft.sort).toEqual([])
      expect(draft.visualization.type).toBe('TABLE')
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

  describe('clearSourceSelections (edge E7)', () => {
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

  describe('serializeConfig / configToDraft', () => {
    it('returns null when the draft has no source (invalid drafts never requested)', () => {
      const draft = { ...createEmptyDraft(), dimensions: validDraft().dimensions }
      expect(serializeConfig(draft)).toBeNull()
    })

    it('serializes a valid draft to a versioned config', () => {
      const draft = validDraft()
      draft.sort = [{ id: 'sort-1', targetId: 'met-2', direction: 'DESC' }]
      const config = serializeConfig(draft)
      expect(config).not.toBeNull()
      expect(config?.version).toBe(1)
      expect(config?.dataSource).toBe('DEALS')
      expect(config?.dimensions).toHaveLength(1)
      expect(config?.metrics).toHaveLength(2)
      expect(config?.visualization.type).toBe('TABLE')
      expect(config?.sort).toEqual([{ id: 'sort-1', targetId: 'met-2', direction: 'DESC' }])
    })

    it('round-trips a saved config back into a draft (edit mode)', () => {
      const draft = validDraft()
      draft.sort = [{ id: 'sort-1', targetId: 'met-2', direction: 'DESC' }]
      const config = serializeConfig(draft) as CustomReportConfig
      const restored = configToDraft(config)
      expect(restored.source).toBe('DEALS')
      expect(restored.dimensions).toEqual(validDraft().dimensions)
      expect(restored.metrics).toEqual(validDraft().metrics)
      expect(restored.visualization).toEqual(validDraft().visualization)
      expect(restored.sort).toEqual([{ id: 'sort-1', targetId: 'met-2', direction: 'DESC' }])
    })
  })

  describe('validateDraft (AC 15, E3)', () => {
    it('flags missing dimension and metric as not saveable', () => {
      const empty = createEmptyDraft()
      const result = validateDraft(empty, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.previewable).toBe(false)
      expect(result.errors.join(' ')).toContain('dimension')
      expect(result.errors.join(' ')).toContain('metric')
    })

    it('accepts a valid draft', () => {
      const result = validateDraft(validDraft(), DEALS_CATALOG)
      expect(result.saveable).toBe(true)
      expect(result.previewable).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('flags a PIE draft with two dimensions as not previewable (chart incompatibility)', () => {
      const draft = {
        ...validDraft(),
        visualization: { ...validDraft().visualization, type: 'PIE' as const },
        dimensions: [
          { id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null },
          { id: 'd2', fieldId: 'deal.status', calculation: null, granularity: null },
        ],
      }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.previewable).toBe(false)
    })

    it('flags a FUNNEL draft on a non-DEALS source as not previewable', () => {
      const draft = {
        ...validDraft(),
        source: 'CONTACTS' as const,
        visualization: { ...validDraft().visualization, type: 'FUNNEL' as const },
        dimensions: [{ id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null }],
        metrics: [{ id: 'm1', fieldId: 'deal.id', aggregation: 'COUNT' as const, alias: 'deals' }],
      }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.previewable).toBe(false)
    })

    it('flags a LINE draft without a date first dimension as not previewable', () => {
      const draft = {
        ...validDraft(),
        visualization: { ...validDraft().visualization, type: 'LINE' as const },
        dimensions: [{ id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null }],
        metrics: [
          { id: 'm1', fieldId: 'deal.value', aggregation: 'SUM' as const, alias: 'revenue' },
        ],
      }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.previewable).toBe(false)
    })

    it('flags a BAR draft without a numeric metric as not previewable', () => {
      const draft = {
        ...validDraft(),
        visualization: { ...validDraft().visualization, type: 'BAR' as const },
        dimensions: [{ id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null }],
        metrics: [{ id: 'm1', fieldId: 'deal.id', aggregation: 'COUNT' as const, alias: 'deals' }],
      }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.previewable).toBe(false)
    })

    it('rejects more than 3 dimensions', () => {
      const draft = validDraft()
      draft.dimensions = [
        { id: 'd1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
        { id: 'd2', fieldId: 'deal.stage', calculation: null, granularity: null },
        { id: 'd3', fieldId: 'deal.status', calculation: null, granularity: null },
        { id: 'd4', fieldId: 'deal.id', calculation: null, granularity: null },
      ]
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.errors.join(' ')).toContain('3 dimensions')
    })

    it('rejects more than 10 metrics total (base + calculated)', () => {
      const draft = validDraft()
      draft.metrics = Array.from({ length: 10 }, (_, i) => ({
        id: `m${i}`,
        fieldId: 'deal.id',
        aggregation: 'COUNT' as const,
        alias: `m${i}`,
      }))
      draft.calculatedFields = [{ id: 'c1', alias: 'extra', label: null, expression: 'm0 + m1' }]
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.errors.join(' ')).toContain('10 metrics')
    })

    it('rejects more than 10 filters', () => {
      const draft = validDraft()
      draft.filters = Array.from({ length: 11 }, (_, i) => ({
        id: `f${i}`,
        fieldId: 'deal.stage',
        operator: 'EQ' as const,
        stringValue: 'x',
        numberValue: null,
        booleanValue: null,
        dateValue: null,
        stringValues: null,
        numberValues: null,
        dateValues: null,
      }))
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.errors.join(' ')).toContain('10 filters')
    })

    it('rejects unknown field keys (closed catalogue)', () => {
      const draft = validDraft()
      draft.metrics[0] = {
        id: 'met-1',
        fieldId: 'deal.arbitraryColumn',
        aggregation: 'COUNT',
        alias: 'deals',
      }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
    })

    it('rejects a metric whose field does not allow the aggregation', () => {
      const draft = validDraft()
      draft.metrics[1] = { id: 'met-2', fieldId: 'deal.stage', aggregation: 'SUM', alias: 'bad' }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.errors.join(' ')).toContain('SUM')
    })

    it('rejects a date dimension without granularity', () => {
      const draft = validDraft()
      draft.dimensions[0] = {
        id: 'dim-1',
        fieldId: 'deal.createdAt',
        calculation: null,
        granularity: null,
      }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
    })

    it('rejects duplicate selected ids', () => {
      const draft = validDraft()
      draft.dimensions.push({
        id: 'dim-1',
        fieldId: 'deal.stage',
        calculation: null,
        granularity: null,
      })
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
    })

    it('rejects duplicate metric aliases', () => {
      const draft = validDraft()
      draft.metrics[1] = { id: 'met-2', fieldId: 'deal.value', aggregation: 'SUM', alias: 'deals' }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
    })

    it('rejects a sort rule referencing an unselected item', () => {
      const draft = validDraft()
      draft.sort = [{ id: 's1', targetId: 'missing-metric', direction: 'ASC' }]
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.errors.join(' ')).toContain('unselected')
    })

    it('rejects granularity on a non-date dimension', () => {
      const draft = validDraft()
      draft.dimensions[0] = {
        id: 'dim-1',
        fieldId: 'deal.stage',
        calculation: null,
        granularity: 'MONTH',
      }
      const result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.errors.join(' ')).toContain('not a date field')
    })

    it('rejects empty calculated-field aliases and expressions', () => {
      const draft = validDraft()
      draft.calculatedFields = [
        { id: 'c1', alias: '  ', label: null, expression: 'revenue / deals' },
      ]
      let result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      draft.calculatedFields = [{ id: 'c1', alias: 'avg', label: null, expression: '  ' }]
      result = validateDraft(draft, DEALS_CATALOG)
      expect(result.saveable).toBe(false)
      expect(result.errors.join(' ')).toContain('needs an expression')
    })
  })

  describe('chartCompatibilityErrors (AC 9, E1)', () => {
    it('accepts TABLE for any otherwise-valid config', () => {
      expect(chartCompatibilityErrors('TABLE', validDraft(), DEALS_CATALOG)).toEqual([])
    })

    it('rejects LINE without a date first dimension', () => {
      const draft = validDraft()
      draft.dimensions[0] = {
        id: 'dim-1',
        fieldId: 'deal.stage',
        calculation: null,
        granularity: null,
      }
      expect(chartCompatibilityErrors('LINE', draft, DEALS_CATALOG).join(' ')).toContain('date')
    })

    it('rejects LINE without a numeric metric', () => {
      const draft = validDraft()
      draft.metrics = [{ id: 'met-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' }]
      expect(chartCompatibilityErrors('LINE', draft, DEALS_CATALOG).join(' ')).toContain('numeric')
    })

    it('accepts LINE with a date first dimension and a numeric metric', () => {
      expect(chartCompatibilityErrors('LINE', validDraft(), DEALS_CATALOG)).toEqual([])
    })

    it('rejects BAR with more than 2 dimensions', () => {
      const draft = validDraft()
      draft.dimensions = [
        { id: 'd1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
        { id: 'd2', fieldId: 'deal.stage', calculation: null, granularity: null },
        { id: 'd3', fieldId: 'deal.status', calculation: null, granularity: null },
      ]
      expect(chartCompatibilityErrors('BAR', draft, DEALS_CATALOG).join(' ')).toContain(
        '1–2 dimensions',
      )
    })

    it('accepts BAR with 2 dimensions and a numeric metric', () => {
      const draft = validDraft()
      draft.dimensions = [
        { id: 'd1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
        { id: 'd2', fieldId: 'deal.stage', calculation: null, granularity: null },
      ]
      expect(chartCompatibilityErrors('BAR', draft, DEALS_CATALOG)).toEqual([])
    })

    it('rejects PIE without exactly one dimension and one metric', () => {
      expect(chartCompatibilityErrors('PIE', validDraft(), DEALS_CATALOG).length).toBeGreaterThan(0)
      const draft = validDraft()
      draft.dimensions = [{ id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null }]
      draft.metrics = [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }]
      expect(chartCompatibilityErrors('PIE', draft, DEALS_CATALOG)).toEqual([])
    })

    it('rejects FUNNEL without the DEALS source', () => {
      const draft = validDraft()
      draft.source = 'CONTACTS'
      expect(chartCompatibilityErrors('FUNNEL', draft, DEALS_CATALOG).join(' ')).toContain('Deals')
    })

    it('rejects FUNNEL without a stage dimension', () => {
      const draft = validDraft()
      draft.dimensions[0] = {
        id: 'dim-1',
        fieldId: 'deal.status',
        calculation: null,
        granularity: null,
      }
      expect(chartCompatibilityErrors('FUNNEL', draft, DEALS_CATALOG).join(' ')).toContain('Stage')
    })

    it('accepts FUNNEL with DEALS + stage dimension + COUNT metric', () => {
      const draft = validDraft()
      draft.dimensions = [{ id: 'd1', fieldId: 'deal.stage', calculation: null, granularity: null }]
      draft.metrics = [{ id: 'm1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' }]
      expect(chartCompatibilityErrors('FUNNEL', draft, DEALS_CATALOG)).toEqual([])
    })
  })

  describe('expressionDiagnostics (AC 13, E4/E8 — client mirror)', () => {
    const ALIASES = ['revenue', 'deals']

    it('accepts a valid expression with precedence', () => {
      expect(expressionDiagnostics('revenue / deals', ALIASES).error).toBeNull()
      expect(expressionDiagnostics('revenue + deals * 2', ALIASES).error).toBeNull()
      expect(expressionDiagnostics('(revenue + deals) * 2', ALIASES).error).toBeNull()
    })

    it('rejects unknown aliases', () => {
      expect(expressionDiagnostics('revenue / nope', ALIASES).error).toContain('nope')
    })

    it('rejects empty expressions and unexpected characters', () => {
      expect(expressionDiagnostics('', ALIASES).error).toBeTruthy()
      expect(expressionDiagnostics('revenue; DROP TABLE', ALIASES).error).toBeTruthy()
    })

    it('rejects unbalanced parentheses and trailing input', () => {
      expect(expressionDiagnostics('(revenue + deals', ALIASES).error).toBeTruthy()
      expect(expressionDiagnostics('revenue deals', ALIASES).error).toBeTruthy()
    })

    it('flags division by zero as a warning, never an error', () => {
      const result = expressionDiagnostics('revenue / 0', ALIASES)
      expect(result.error).toBeNull()
      expect(result.warning).toContain('zero')
    })

    it('rejects expressions exceeding the token cap', () => {
      // ~119 tokens but under the 200-character cap — exercises the token limit.
      const long = Array.from({ length: 60 }, (_, i) => i).join('+')
      expect(long.length).toBeLessThan(200)
      expect(expressionDiagnostics(long, ALIASES).error).toContain('50 tokens')
    })

    it('rejects malformed numeric literals', () => {
      expect(expressionDiagnostics('revenue + 1.2.3', ALIASES).error).toContain('Invalid number')
    })
  })

  describe('customReportDraftReducer', () => {
    it('SET_SOURCE changes the source', () => {
      const state = customReportDraftReducer(createEmptyDraft(), {
        type: 'SET_SOURCE',
        source: 'DEALS',
      })
      expect(state.source).toBe('DEALS')
    })

    it('CLEAR_SELECTIONS clears after a confirmed source change', () => {
      const state = customReportDraftReducer(validDraft(), { type: 'CLEAR_SELECTIONS' })
      expect(state.dimensions).toEqual([])
      expect(state.metrics).toEqual([])
      expect(state.filters).toEqual([])
      expect(state.calculatedFields).toEqual([])
      expect(state.sort).toEqual([])
    })

    it('ADD_DIMENSION adds and de-duplicates by field', () => {
      let state = customReportDraftReducer(validDraft(), {
        type: 'ADD_DIMENSION',
        fieldId: 'deal.status',
      })
      expect(state.dimensions).toHaveLength(2)
      state = customReportDraftReducer(state, { type: 'ADD_DIMENSION', fieldId: 'deal.status' })
      expect(state.dimensions).toHaveLength(2)
    })

    it('ADD_METRIC adds with the requested aggregation and a unique alias', () => {
      const state = customReportDraftReducer(validDraft(), {
        type: 'ADD_METRIC',
        fieldId: 'deal.value',
        aggregation: 'SUM',
      })
      expect(state.metrics).toHaveLength(3)
      const added = state.metrics[2]
      expect(added.aggregation).toBe('SUM')
      expect(added.alias).not.toBe('deals')
      expect(added.alias).not.toBe('revenue')
    })

    it('REMOVE_ITEM removes a dimension or metric by id', () => {
      let state = customReportDraftReducer(validDraft(), {
        type: 'REMOVE_ITEM',
        role: 'dimension',
        id: 'dim-1',
      })
      expect(state.dimensions).toHaveLength(0)
      state = customReportDraftReducer(validDraft(), {
        type: 'REMOVE_ITEM',
        role: 'metric',
        id: 'met-1',
      })
      expect(state.metrics).toHaveLength(1)
    })

    it('MOVE_ITEM reorders within a list (grouping order = dimensions order, AC 14)', () => {
      const draft = validDraft()
      draft.dimensions = [
        { id: 'd1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
        { id: 'd2', fieldId: 'deal.stage', calculation: null, granularity: null },
      ]
      const state = customReportDraftReducer(draft, {
        type: 'MOVE_ITEM',
        role: 'dimension',
        id: 'd2',
        direction: 'up',
      })
      expect(state.dimensions[0].id).toBe('d2')
      expect(state.dimensions[1].id).toBe('d1')
    })

    it('REORDER_ITEMS applies a drag-reordered id list (DnD sort within a list)', () => {
      const draft = validDraft()
      draft.dimensions = [
        { id: 'd1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
        { id: 'd2', fieldId: 'deal.stage', calculation: null, granularity: null },
        { id: 'd3', fieldId: 'deal.status', calculation: null, granularity: null },
      ]
      const state = customReportDraftReducer(draft, {
        type: 'REORDER_ITEMS',
        role: 'dimension',
        orderedIds: ['d3', 'd1', 'd2'],
      })
      expect(state.dimensions.map((d) => d.id)).toEqual(['d3', 'd1', 'd2'])
    })

    it('SET_AGGREGATION updates a metric aggregation and keeps a stable alias', () => {
      const state = customReportDraftReducer(validDraft(), {
        type: 'SET_AGGREGATION',
        metricId: 'met-2',
        aggregation: 'AVERAGE',
      })
      expect(state.metrics[1].aggregation).toBe('AVERAGE')
      expect(state.metrics[1].alias).toBe('revenue')
    })

    it('SET_GRANULARITY updates a date dimension', () => {
      const state = customReportDraftReducer(validDraft(), {
        type: 'SET_GRANULARITY',
        dimensionId: 'dim-1',
        granularity: 'QUARTER',
      })
      expect(state.dimensions[0].granularity).toBe('QUARTER')
    })

    it('ADD/UPDATE/REMOVE_CALCULATED_FIELD manage the calc list', () => {
      const withCalc = customReportDraftReducer(validDraft(), {
        type: 'ADD_CALCULATED_FIELD',
        field: {
          id: 'calc-1',
          alias: 'avg_deal_size',
          label: 'Avg deal size',
          expression: 'revenue / deals',
        },
      })
      expect(withCalc.calculatedFields).toHaveLength(1)
      const updated = customReportDraftReducer(withCalc, {
        type: 'UPDATE_CALCULATED_FIELD',
        id: 'calc-1',
        patch: { expression: 'revenue * 2' },
      })
      expect(updated.calculatedFields[0].expression).toBe('revenue * 2')
      const removed = customReportDraftReducer(withCalc, {
        type: 'REMOVE_CALCULATED_FIELD',
        id: 'calc-1',
      })
      expect(removed.calculatedFields).toHaveLength(0)
    })

    it('SET_CHART_TYPE and UPDATE_VISUALIZATION mutate visualization', () => {
      const state = customReportDraftReducer(validDraft(), {
        type: 'SET_CHART_TYPE',
        chartType: 'BAR',
      })
      expect(state.visualization.type).toBe('BAR')
      const updated = customReportDraftReducer(state, {
        type: 'UPDATE_VISUALIZATION',
        patch: { showDataLabels: true, orientation: 'HORIZONTAL' },
      })
      expect(updated.visualization.showDataLabels).toBe(true)
      expect(updated.visualization.orientation).toBe('HORIZONTAL')
    })

    it('SET_CHART_TYPE clears orientation when leaving BAR and defaults it when entering BAR (AC 9/16)', () => {
      // BAR with orientation → TABLE: orientation must be dropped so the
      // server does not reject a non-BAR chart for a stale orientation.
      const bar = customReportDraftReducer(validDraft(), {
        type: 'SET_CHART_TYPE',
        chartType: 'BAR',
      })
      expect(bar.visualization.type).toBe('BAR')
      expect(bar.visualization.orientation).toBe('VERTICAL')

      const table = customReportDraftReducer(bar, { type: 'SET_CHART_TYPE', chartType: 'TABLE' })
      expect(table.visualization.type).toBe('TABLE')
      expect(table.visualization.orientation).toBeNull()

      // Switching back to BAR restores a valid default orientation.
      const barAgain = customReportDraftReducer(table, { type: 'SET_CHART_TYPE', chartType: 'BAR' })
      expect(barAgain.visualization.orientation).toBe('VERTICAL')

      // The default visualization (TABLE) must not carry an orientation.
      expect(defaultVisualization().orientation).toBeNull()
    })

    it('ADD/REMOVE/SET/MOVE sort manage sort entries referencing selected ids (AC 14)', () => {
      let state = customReportDraftReducer(validDraft(), {
        type: 'ADD_SORT',
        sort: { id: 'sort-1', targetId: 'met-2', direction: 'DESC' },
      })
      expect(state.sort).toHaveLength(1)
      state = customReportDraftReducer(state, {
        type: 'SET_SORT_DIRECTION',
        id: 'sort-1',
        direction: 'ASC',
      })
      expect(state.sort[0].direction).toBe('ASC')
      // Declared priority is the array order — MOVE_SORT reorders without new ids.
      state = customReportDraftReducer(state, {
        type: 'ADD_SORT',
        sort: { id: 'sort-2', targetId: 'met-1', direction: 'DESC' },
      })
      expect(state.sort.map((s) => s.id)).toEqual(['sort-1', 'sort-2'])
      state = customReportDraftReducer(state, { type: 'MOVE_SORT', id: 'sort-2', direction: 'up' })
      expect(state.sort.map((s) => s.id)).toEqual(['sort-2', 'sort-1'])
      state = customReportDraftReducer(state, {
        type: 'MOVE_SORT',
        id: 'sort-2',
        direction: 'down',
      })
      expect(state.sort.map((s) => s.id)).toEqual(['sort-1', 'sort-2'])
      state = customReportDraftReducer(state, { type: 'MOVE_SORT', id: 'sort-2', direction: 'up' })
      state = customReportDraftReducer(state, { type: 'MOVE_SORT', id: 'sort-2', direction: 'up' })
      // Moving past the top is a no-op — the order is unchanged.
      expect(state.sort.map((s) => s.id)).toEqual(['sort-2', 'sort-1'])
      state = customReportDraftReducer(state, { type: 'REMOVE_SORT', id: 'sort-1' })
      expect(state.sort).toHaveLength(1)
    })

    it('LOAD_CONFIG seeds the draft from a saved config', () => {
      const config = serializeConfig(validDraft()) as CustomReportConfig
      const state = customReportDraftReducer(createEmptyDraft(), { type: 'LOAD_CONFIG', config })
      expect(state.source).toBe('DEALS')
      expect(state.metrics).toHaveLength(2)
    })

    it('RESET returns an empty draft', () => {
      const state = customReportDraftReducer(validDraft(), { type: 'RESET' })
      expect(state.source).toBeNull()
      expect(state.dimensions).toEqual([])
    })
  })
})
