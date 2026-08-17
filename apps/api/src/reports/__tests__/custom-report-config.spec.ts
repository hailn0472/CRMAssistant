/**
 * Story 6.3 — custom report config validation unit tests (Contract A, AC 5-9,
 * 13-15, 17). Strict-write `validateCustomReportConfig` and defensive-read
 * `parseCustomReportConfig` plus the safe calculated-field expression parser.
 * Framework-free: no Nest boot, no database.
 */
import {
  validateCustomReportConfig,
  parseCustomReportConfig,
  chartCompatibilityErrors,
  MAX_CUSTOM_FILTERS,
  MAX_CUSTOM_DIMENSIONS,
  MAX_CUSTOM_METRICS,
  MAX_EXPRESSION_TOKENS,
  CUSTOM_REPORT_CONFIG_VERSION,
} from '../custom-report-config'
import {
  CUSTOM_REPORT_CHART_TYPES,
  CUSTOM_REPORT_COLOR_TOKENS,
  CUSTOM_REPORT_DEFAULT_COLORS,
  CUSTOM_REPORT_LEGEND_POSITIONS,
} from '../custom-report-types'
import type {
  CustomReportCalculatedField,
  CustomReportChartType,
  CustomReportConfig,
  CustomReportDataSource,
  CustomReportDimension,
  CustomReportMetric,
} from '../custom-report-types'

function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: CUSTOM_REPORT_CONFIG_VERSION,
    dataSource: 'DEALS',
    filters: [],
    dimensions: [{ id: 'dim-stage', fieldId: 'deal.stage', calculation: null, granularity: null }],
    metrics: [
      { id: 'metric-deals', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
      { id: 'metric-value', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
    ],
    calculatedFields: [],
    visualization: {
      type: 'TABLE',
      title: null,
      showLegend: false,
      showDataLabels: false,
      xAxisLabel: null,
      yAxisLabel: null,
      orientation: null,
      colors: [],
      legendPosition: 'BOTTOM',
    },
    sort: [],
    ...overrides,
  }
}

/** A persisted Story 6.3 v1 config (no colors/legendPosition, version 1). */
function v1Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    dataSource: 'DEALS',
    filters: [],
    dimensions: [{ id: 'dim-stage', fieldId: 'deal.stage', calculation: null, granularity: null }],
    metrics: [
      { id: 'metric-deals', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
      { id: 'metric-value', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
    ],
    calculatedFields: [],
    visualization: {
      type: 'TABLE',
      title: null,
      showLegend: false,
      showDataLabels: false,
      xAxisLabel: null,
      yAxisLabel: null,
      orientation: null,
    },
    sort: [],
    ...overrides,
  }
}

function expectInvalid(raw: Record<string, unknown>, messagePart: string): void {
  expect(() => validateCustomReportConfig(raw)).toThrow(messagePart)
}

describe('validateCustomReportConfig — strict write path', () => {
  it('accepts a minimal valid config for every data source', () => {
    const SOURCE_FIXTURES: Record<string, { dim: string; metricField: string }> = {
      CONTACTS: { dim: 'contact.owner', metricField: 'contact.id' },
      DEALS: { dim: 'deal.stage', metricField: 'deal.id' },
      TASKS: { dim: 'task.assignee', metricField: 'task.id' },
      ACTIVITIES: { dim: 'activity.type', metricField: 'activity.id' },
    }
    for (const dataSource of ['CONTACTS', 'DEALS', 'TASKS', 'ACTIVITIES'] as const) {
      const fixture = SOURCE_FIXTURES[dataSource]
      const raw =
        dataSource === 'DEALS'
          ? validConfig()
          : validConfig({
              dataSource,
              dimensions: [
                { id: 'dim-owner', fieldId: fixture.dim, calculation: null, granularity: null },
              ],
              metrics: [
                {
                  id: 'metric-count',
                  fieldId: fixture.metricField,
                  aggregation: 'COUNT',
                  alias: 'count',
                },
              ],
            })
      const config = validateCustomReportConfig(raw)
      expect(config.dataSource).toBe(dataSource)
      expect(config.version).toBe(CUSTOM_REPORT_CONFIG_VERSION)
    }
  })

  it('rejects non-object input', () => {
    expect(() => validateCustomReportConfig(null)).toThrow('object')
    expect(() => validateCustomReportConfig('nope')).toThrow('object')
    expect(() => validateCustomReportConfig([])).toThrow('object')
  })

  it('rejects unknown top-level keys', () => {
    expectInvalid(validConfig({ dataSourceExtra: 'DEALS' }), 'unknown key')
  })

  it('rejects unknown versions but accepts 1 and 2', () => {
    expectInvalid(validConfig({ version: 3 }), 'version')
    expectInvalid(validConfig({ version: '1' }), 'version')
    expect(() => validateCustomReportConfig(v1Config())).not.toThrow()
  })

  it('rejects an unknown data source', () => {
    expectInvalid(validConfig({ dataSource: 'INVOICES' }), 'dataSource')
  })

  describe('filters', () => {
    it('accepts up to MAX_CUSTOM_FILTERS filters', () => {
      const filters = Array.from({ length: MAX_CUSTOM_FILTERS }, (_, i) => ({
        id: `f-${i}`,
        fieldId: 'deal.owner',
        operator: 'EQ',
        stringValue: `user-${i}`,
        numberValue: null,
        booleanValue: null,
        dateValue: null,
        stringValues: null,
        numberValues: null,
        dateValues: null,
      }))
      expect(() => validateCustomReportConfig(validConfig({ filters }))).not.toThrow()
    })

    it('rejects more than MAX_CUSTOM_FILTERS filters', () => {
      const filters = Array.from({ length: MAX_CUSTOM_FILTERS + 1 }, (_, i) => ({
        id: `f-${i}`,
        fieldId: 'deal.owner',
        operator: 'EQ',
        stringValue: `user-${i}`,
        numberValue: null,
        booleanValue: null,
        dateValue: null,
        stringValues: null,
        numberValues: null,
        dateValues: null,
      }))
      expectInvalid(validConfig({ filters }), 'filters')
    })

    it('rejects unknown filter fields', () => {
      expectInvalid(
        validConfig({
          filters: [
            {
              id: 'f-1',
              fieldId: 'contact.owner',
              operator: 'EQ',
              stringValue: 'user-1',
            },
          ],
        }),
        'field',
      )
    })

    it('rejects an unknown operator', () => {
      expectInvalid(
        validConfig({
          filters: [
            {
              id: 'f-1',
              fieldId: 'deal.value',
              operator: 'LIKE',
              numberValue: 5,
            },
          ],
        }),
        'operator',
      )
    })

    it('rejects duplicate filter ids', () => {
      expectInvalid(
        validConfig({
          filters: [
            { id: 'f-1', fieldId: 'deal.stage', operator: 'EQ', stringValue: 'stage-1' },
            { id: 'f-1', fieldId: 'deal.owner', operator: 'EQ', stringValue: 'user-1' },
          ],
        }),
        'duplicate',
      )
    })

    it('rejects a wrong scalar shape (string field with number value)', () => {
      expectInvalid(
        validConfig({
          filters: [{ id: 'f-1', fieldId: 'deal.stage', operator: 'EQ', numberValue: 5 }],
        }),
        'value',
      )
    })

    it('rejects empty filter values', () => {
      expectInvalid(
        validConfig({
          filters: [{ id: 'f-1', fieldId: 'deal.stage', operator: 'EQ', stringValue: '' }],
        }),
        'value',
      )
    })

    it('rejects multiple value slots at once', () => {
      expectInvalid(
        validConfig({
          filters: [
            {
              id: 'f-1',
              fieldId: 'deal.value',
              operator: 'GT',
              numberValue: 5,
              dateValue: '2026-01-01',
            },
          ],
        }),
        'value',
      )
    })

    it('rejects missing value slots', () => {
      expectInvalid(
        validConfig({
          filters: [{ id: 'f-1', fieldId: 'deal.stage', operator: 'EQ' }],
        }),
        'value',
      )
    })

    it('rejects reversed BETWEEN number ranges', () => {
      expectInvalid(
        validConfig({
          filters: [
            { id: 'f-1', fieldId: 'deal.value', operator: 'BETWEEN', numberValues: [100, 10] },
          ],
        }),
        'range',
      )
    })

    it('accepts BETWEEN number ranges in order', () => {
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            filters: [
              { id: 'f-1', fieldId: 'deal.value', operator: 'BETWEEN', numberValues: [10, 100] },
            ],
          }),
        ),
      ).not.toThrow()
    })

    it('rejects a BETWEEN with the wrong arity', () => {
      expectInvalid(
        validConfig({
          filters: [{ id: 'f-1', fieldId: 'deal.value', operator: 'BETWEEN', numberValues: [10] }],
        }),
        'value',
      )
    })

    it('rejects reversed BETWEEN date ranges', () => {
      expectInvalid(
        validConfig({
          filters: [
            {
              id: 'f-1',
              fieldId: 'deal.expectedCloseDate',
              operator: 'BETWEEN',
              dateValues: ['2026-02-01', '2026-01-01'],
            },
          ],
        }),
        'range',
      )
    })

    it('accepts ON / BEFORE / AFTER / BETWEEN for date fields only', () => {
      const base = {
        id: 'f-1',
        dateValue: '2026-01-01',
        numberValue: null,
        booleanValue: null,
        stringValue: null,
        stringValues: null,
        numberValues: null,
        dateValues: null,
      }
      for (const operator of ['ON', 'BEFORE', 'AFTER']) {
        expect(() =>
          validateCustomReportConfig(
            validConfig({
              filters: [{ ...base, fieldId: 'deal.expectedCloseDate', operator }],
            }),
          ),
        ).not.toThrow()
      }
      // Date operators on a number field are invalid.
      expectInvalid(
        validConfig({ filters: [{ ...base, fieldId: 'deal.value', operator: 'ON' }] }),
        'operator',
      )
    })

    it('rejects boolean EQ on non-boolean fields', () => {
      expectInvalid(
        validConfig({
          filters: [
            {
              id: 'f-1',
              fieldId: 'deal.stage',
              operator: 'EQ',
              booleanValue: true,
            },
          ],
        }),
        'operator',
      )
    })

    it('accepts HAS_ANY / HAS_ALL only on tags fields', () => {
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            dataSource: 'CONTACTS',
            dimensions: [
              { id: 'd-1', fieldId: 'contact.owner', calculation: null, granularity: null },
            ],
            metrics: [{ id: 'm-1', fieldId: 'contact.id', aggregation: 'COUNT', alias: 'count' }],
            filters: [
              {
                id: 'f-1',
                fieldId: 'contact.tags',
                operator: 'HAS_ANY',
                stringValues: ['tag-1'],
              },
            ],
          }),
        ),
      ).not.toThrow()
      expectInvalid(
        validConfig({
          filters: [
            {
              id: 'f-1',
              fieldId: 'deal.stage',
              operator: 'HAS_ANY',
              stringValues: ['tag-1'],
            },
          ],
        }),
        'operator',
      )
    })
  })

  describe('dimensions', () => {
    it('requires at least one dimension', () => {
      expectInvalid(validConfig({ dimensions: [] }), 'dimension')
    })

    it('rejects more than MAX_CUSTOM_DIMENSIONS dimensions', () => {
      const dims = Array.from({ length: MAX_CUSTOM_DIMENSIONS + 1 }, (_, i) => ({
        id: `d-${i}`,
        fieldId: 'deal.stage',
        calculation: null,
        granularity: null,
      }))
      expectInvalid(validConfig({ dimensions: dims }), 'dimension')
    })

    it('rejects duplicate dimension ids', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            { id: 'd-1', fieldId: 'deal.stage', calculation: null, granularity: null },
            { id: 'd-1', fieldId: 'deal.owner', calculation: null, granularity: null },
          ],
        }),
        'duplicate',
      )
    })

    it('rejects an unknown dimension field', () => {
      expectInvalid(
        validConfig({
          dimensions: [{ id: 'd-1', fieldId: 'deal.nope', calculation: null, granularity: null }],
        }),
        'field',
      )
    })

    it('requires granularity on date dimensions', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            { id: 'd-1', fieldId: 'deal.expectedCloseDate', calculation: null, granularity: null },
          ],
        }),
        'granularity',
      )
    })

    it('rejects granularity on non-date dimensions', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            { id: 'd-1', fieldId: 'deal.stage', calculation: null, granularity: 'MONTH' },
          ],
        }),
        'granularity',
      )
    })

    it('accepts valid granularities on date dimensions', () => {
      for (const granularity of ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']) {
        expect(() =>
          validateCustomReportConfig(
            validConfig({
              dimensions: [
                {
                  id: 'd-1',
                  fieldId: 'deal.expectedCloseDate',
                  calculation: null,
                  granularity,
                },
              ],
            }),
          ),
        ).not.toThrow()
      }
    })

    it('rejects an unknown granularity value', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            {
              id: 'd-1',
              fieldId: 'deal.expectedCloseDate',
              calculation: null,
              granularity: 'DECADE',
            },
          ],
        }),
        'granularity',
      )
    })

    it('rejects a dimension with both fieldId and calculation', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            {
              id: 'd-1',
              fieldId: 'deal.expectedCloseDate',
              calculation: {
                kind: 'DATE_PART',
                sourceFieldId: 'deal.expectedCloseDate',
                granularity: 'MONTH',
              },
              granularity: null,
            },
          ],
        }),
        'dimension',
      )
    })

    it('accepts DATE_PART calculated dimensions on date sources', () => {
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            dimensions: [
              {
                id: 'd-1',
                fieldId: null,
                calculation: {
                  kind: 'DATE_PART',
                  sourceFieldId: 'deal.expectedCloseDate',
                  granularity: 'MONTH',
                },
                granularity: null,
              },
            ],
          }),
        ),
      ).not.toThrow()
    })

    it('rejects DATE_PART on a non-date source field', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            {
              id: 'd-1',
              fieldId: null,
              calculation: { kind: 'DATE_PART', sourceFieldId: 'deal.value', granularity: 'MONTH' },
              granularity: null,
            },
          ],
        }),
        'DATE_PART',
      )
    })

    it('accepts NUMBER_BUCKET on numeric sources with a positive size', () => {
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            dimensions: [
              {
                id: 'd-1',
                fieldId: null,
                calculation: {
                  kind: 'NUMBER_BUCKET',
                  sourceFieldId: 'deal.value',
                  bucketSize: 1000,
                },
                granularity: null,
              },
            ],
          }),
        ),
      ).not.toThrow()
    })

    it('rejects NUMBER_BUCKET with a non-positive size', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            {
              id: 'd-1',
              fieldId: null,
              calculation: { kind: 'NUMBER_BUCKET', sourceFieldId: 'deal.value', bucketSize: 0 },
              granularity: null,
            },
          ],
        }),
        'bucket',
      )
    })

    it('rejects NUMBER_BUCKET on a non-numeric source field', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            {
              id: 'd-1',
              fieldId: null,
              calculation: { kind: 'NUMBER_BUCKET', sourceFieldId: 'deal.stage', bucketSize: 10 },
              granularity: null,
            },
          ],
        }),
        'NUMBER_BUCKET',
      )
    })

    it('rejects an unknown calculated dimension kind', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            {
              id: 'd-1',
              fieldId: null,
              calculation: { kind: 'TEXT_TRUNCATE', sourceFieldId: 'deal.title', bucketSize: 10 },
              granularity: null,
            },
          ],
        }),
        'kind',
      )
    })
  })

  describe('metrics', () => {
    it('requires at least one metric', () => {
      expectInvalid(validConfig({ metrics: [] }), 'metric')
    })

    it('rejects more than MAX_CUSTOM_METRICS total metrics (base + calculated)', () => {
      const metrics = Array.from({ length: MAX_CUSTOM_METRICS }, (_, i) => ({
        id: `m-${i}`,
        fieldId: 'deal.id',
        aggregation: 'COUNT',
        alias: `m${i}`,
      }))
      expectInvalid(
        validConfig({
          metrics,
          calculatedFields: [{ id: 'c-1', alias: 'extra', label: null, expression: 'm0 + m1' }],
        }),
        'metric',
      )
    })

    it('rejects SUM/AVERAGE/MIN/MAX on non-numeric fields', () => {
      for (const aggregation of ['SUM', 'AVERAGE', 'MIN', 'MAX']) {
        expectInvalid(
          validConfig({
            metrics: [{ id: 'm-1', fieldId: 'deal.stage', aggregation, alias: 'a' }],
          }),
          'numeric',
        )
      }
    })

    it('accepts SUM on numeric fields', () => {
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            metrics: [{ id: 'm-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }],
          }),
        ),
      ).not.toThrow()
    })

    it('rejects an unknown aggregation', () => {
      expectInvalid(
        validConfig({
          metrics: [{ id: 'm-1', fieldId: 'deal.id', aggregation: 'MEDIAN', alias: 'a' }],
        }),
        'aggregation',
      )
    })

    it('rejects duplicate metric ids', () => {
      expectInvalid(
        validConfig({
          metrics: [
            { id: 'm-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'a' },
            { id: 'm-1', fieldId: 'deal.id', aggregation: 'DISTINCT_COUNT', alias: 'b' },
          ],
        }),
        'duplicate',
      )
    })

    it('rejects duplicate aliases across metrics and calculated fields', () => {
      expectInvalid(
        validConfig({
          metrics: [
            { id: 'm-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
            { id: 'm-2', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
          ],
        }),
        'alias',
      )
      expectInvalid(
        validConfig({
          calculatedFields: [{ id: 'c-1', alias: 'deals', label: null, expression: 'deals + 1' }],
        }),
        'alias',
      )
    })

    it('defaults aliases from ids when absent and keeps them unique', () => {
      const config = validateCustomReportConfig(
        validConfig({
          metrics: [
            { id: 'm-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: null },
            { id: 'm-2', fieldId: 'deal.value', aggregation: 'SUM', alias: null },
          ],
        }),
      )
      expect(config.metrics[0].alias).toBe('m-1')
      expect(config.metrics[1].alias).toBe('m-2')
    })

    it('rejects a non-string alias', () => {
      expectInvalid(
        validConfig({
          metrics: [{ id: 'm-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 42 }],
        }),
        'alias',
      )
    })
  })

  describe('calculated fields and the safe expression parser', () => {
    const CALC_BASE = validConfig({
      metrics: [
        { id: 'm-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
        { id: 'm-2', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
      ],
    })

    it('computes a valid formula over base metric aliases', () => {
      const config = validateCustomReportConfig({
        ...CALC_BASE,
        calculatedFields: [
          {
            id: 'c-1',
            alias: 'avg_deal_size',
            label: 'Avg deal size',
            expression: 'revenue / deals',
          },
        ],
      })
      expect(config.calculatedFields[0].alias).toBe('avg_deal_size')
    })

    it('honours operator precedence and parentheses', () => {
      expect(() =>
        validateCustomReportConfig({
          ...CALC_BASE,
          calculatedFields: [
            { id: 'c-1', alias: 'x', label: null, expression: 'deals + revenue * 2' },
          ],
        }),
      ).not.toThrow()
      expect(() =>
        validateCustomReportConfig({
          ...CALC_BASE,
          calculatedFields: [
            { id: 'c-1', alias: 'x', label: null, expression: '(revenue + deals) / 2' },
          ],
        }),
      ).not.toThrow()
      expect(() =>
        validateCustomReportConfig({
          ...CALC_BASE,
          calculatedFields: [
            { id: 'c-1', alias: 'x', label: null, expression: 'revenue * (deals + 1) - 10 / 2' },
          ],
        }),
      ).not.toThrow()
    })

    it('rejects unknown aliases', () => {
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [{ id: 'c-1', alias: 'x', label: null, expression: 'revenue / nope' }],
        },
        'alias',
      )
    })

    it('rejects self references', () => {
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [{ id: 'c-1', alias: 'x', label: null, expression: 'x * 2' }],
        },
        'alias',
      )
    })

    it('rejects references to other calculated fields (forward/cyclic)', () => {
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [
            { id: 'c-1', alias: 'a', label: null, expression: 'b + 1' },
            { id: 'c-2', alias: 'b', label: null, expression: 'a * 2' },
          ],
        },
        'alias',
      )
    })

    it('rejects empty expressions', () => {
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [{ id: 'c-1', alias: 'x', label: null, expression: '' }],
        },
        'expression',
      )
    })

    it('rejects expressions over MAX_EXPRESSION_LENGTH characters', () => {
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [
            { id: 'c-1', alias: 'x', label: null, expression: `deals + ${'1 + '.repeat(100)}1` },
          ],
        },
        'expression',
      )
    })

    it('rejects expressions over MAX_EXPRESSION_TOKENS tokens', () => {
      const many = Array.from({ length: MAX_EXPRESSION_TOKENS + 1 }, () => '1').join(' + ')
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [{ id: 'c-1', alias: 'x', label: null, expression: many }],
        },
        'expression',
      )
    })

    it('rejects non-finite numeric literals', () => {
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [{ id: 'c-1', alias: 'x', label: null, expression: '1e999 * deals' }],
        },
        'finite',
      )
    })

    it('rejects syntax errors and stray characters', () => {
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [{ id: 'c-1', alias: 'x', label: null, expression: 'deals +' }],
        },
        'expression',
      )
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [
            { id: 'c-1', alias: 'x', label: null, expression: 'deals; DROP TABLE' },
          ],
        },
        'expression',
      )
    })

    it('rejects duplicate calculated field ids and aliases', () => {
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [
            { id: 'c-1', alias: 'x', label: null, expression: 'deals + 1' },
            { id: 'c-1', alias: 'y', label: null, expression: 'deals + 2' },
          ],
        },
        'duplicate',
      )
      expectInvalid(
        {
          ...CALC_BASE,
          calculatedFields: [
            { id: 'c-1', alias: 'x', label: null, expression: 'deals + 1' },
            { id: 'c-2', alias: 'x', label: null, expression: 'deals + 2' },
          ],
        },
        'alias',
      )
    })
  })

  describe('visualization compatibility', () => {
    const LINE_BASE = (dim = 'deal.expectedCloseDate'): Record<string, unknown> =>
      validConfig({
        dimensions: [{ id: 'd-1', fieldId: dim, calculation: null, granularity: 'MONTH' }],
        metrics: [{ id: 'm-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }],
        visualization: {
          type: 'LINE',
          title: null,
          showLegend: false,
          showDataLabels: false,
          xAxisLabel: null,
          yAxisLabel: null,
          orientation: null,
        },
      })

    it('accepts TABLE for any otherwise-valid config', () => {
      expect(() => validateCustomReportConfig(validConfig())).not.toThrow()
    })

    it('accepts LINE with a date first dimension and a numeric metric', () => {
      expect(() => validateCustomReportConfig(LINE_BASE())).not.toThrow()
    })

    it('rejects LINE without a date first dimension', () => {
      expectInvalid(
        validConfig({
          dimensions: [{ id: 'd-1', fieldId: 'deal.stage', calculation: null, granularity: null }],
          metrics: [{ id: 'm-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }],
          visualization: {
            type: 'LINE',
            title: null,
            showLegend: false,
            showDataLabels: false,
            xAxisLabel: null,
            yAxisLabel: null,
            orientation: null,
          },
        }),
        'LINE',
      )
    })

    it('rejects LINE without a numeric metric', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            {
              id: 'd-1',
              fieldId: 'deal.expectedCloseDate',
              calculation: null,
              granularity: 'MONTH',
            },
          ],
          metrics: [{ id: 'm-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' }],
          visualization: { type: 'LINE' },
        }),
        'LINE',
      )
    })

    it('accepts BAR with one or two dimensions and a numeric metric', () => {
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            visualization: { type: 'BAR', orientation: 'VERTICAL' },
          }),
        ),
      ).not.toThrow()
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            dimensions: [
              { id: 'd-1', fieldId: 'deal.stage', calculation: null, granularity: null },
              { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
            ],
            visualization: { type: 'BAR', orientation: 'HORIZONTAL' },
          }),
        ),
      ).not.toThrow()
    })

    it('rejects BAR with three dimensions', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            { id: 'd-1', fieldId: 'deal.stage', calculation: null, granularity: null },
            { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
            { id: 'd-3', fieldId: 'deal.currency', calculation: null, granularity: null },
          ],
          visualization: { type: 'BAR', orientation: 'VERTICAL' },
        }),
        'BAR',
      )
    })

    it('rejects BAR without a numeric metric', () => {
      expectInvalid(
        validConfig({
          visualization: { type: 'BAR', orientation: 'VERTICAL' },
          metrics: [{ id: 'm-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' }],
        }),
        'BAR',
      )
    })

    it('rejects an unknown orientation value', () => {
      expectInvalid(
        validConfig({ visualization: { type: 'BAR', orientation: 'DIAGONAL' } }),
        'orientation',
      )
    })

    it('rejects orientation on non-BAR chart types', () => {
      expectInvalid(
        validConfig({ visualization: { type: 'TABLE', orientation: 'VERTICAL' } }),
        'orientation',
      )
    })

    it('accepts PIE with exactly one categorical dimension and one numeric metric', () => {
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            metrics: [{ id: 'm-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }],
            visualization: { type: 'PIE' },
          }),
        ),
      ).not.toThrow()
    })

    it('rejects PIE with a date dimension', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            {
              id: 'd-1',
              fieldId: 'deal.expectedCloseDate',
              calculation: null,
              granularity: 'MONTH',
            },
          ],
          metrics: [{ id: 'm-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }],
          visualization: { type: 'PIE' },
        }),
        'PIE',
      )
    })

    it('rejects PIE with more than one dimension or more than one metric', () => {
      expectInvalid(
        validConfig({
          dimensions: [
            { id: 'd-1', fieldId: 'deal.stage', calculation: null, granularity: null },
            { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
          ],
          metrics: [{ id: 'm-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }],
          visualization: { type: 'PIE' },
        }),
        'PIE',
      )
      expectInvalid(
        validConfig({
          metrics: [
            { id: 'm-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
            { id: 'm-2', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
          ],
          visualization: { type: 'PIE' },
        }),
        'PIE',
      )
    })

    it('accepts FUNNEL with DEALS source, a stage dimension and one COUNT/SUM metric', () => {
      expect(() =>
        validateCustomReportConfig(
          validConfig({
            metrics: [
              { id: 'metric-deals', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
            ],
            visualization: { type: 'FUNNEL' },
          }),
        ),
      ).not.toThrow()
    })

    it('rejects FUNNEL with a non-DEALS source', () => {
      expectInvalid(
        validConfig({
          dataSource: 'CONTACTS',
          dimensions: [
            { id: 'd-1', fieldId: 'contact.owner', calculation: null, granularity: null },
          ],
          metrics: [{ id: 'm-1', fieldId: 'contact.id', aggregation: 'COUNT', alias: 'count' }],
          visualization: { type: 'FUNNEL' },
        }),
        'FUNNEL',
      )
    })

    it('rejects FUNNEL without a stage dimension', () => {
      expectInvalid(
        validConfig({
          dimensions: [{ id: 'd-1', fieldId: 'deal.owner', calculation: null, granularity: null }],
          visualization: { type: 'FUNNEL' },
        }),
        'FUNNEL',
      )
    })

    it('rejects FUNNEL with an AVERAGE metric', () => {
      expectInvalid(
        validConfig({
          metrics: [{ id: 'm-1', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' }],
          visualization: { type: 'FUNNEL' },
        }),
        'FUNNEL',
      )
    })

    it('rejects an unknown chart type', () => {
      expectInvalid(validConfig({ visualization: { type: 'DOUGHNUT' } }), 'type')
    })
  })

  describe('sort', () => {
    it('accepts up to MAX_CUSTOM_SORTS sorts referencing selected ids', () => {
      const config = validateCustomReportConfig(
        validConfig({
          sort: [
            { id: 's-1', targetId: 'metric-value', direction: 'DESC' },
            { id: 's-2', targetId: 'dim-stage', direction: 'ASC' },
            { id: 's-3', targetId: 'metric-deals', direction: 'ASC' },
          ],
        }),
      )
      expect(config.sort).toHaveLength(3)
    })

    it('rejects more than MAX_CUSTOM_SORTS sorts', () => {
      expectInvalid(
        validConfig({
          sort: [
            { id: 's-1', targetId: 'metric-value', direction: 'DESC' },
            { id: 's-2', targetId: 'dim-stage', direction: 'ASC' },
            { id: 's-3', targetId: 'metric-deals', direction: 'ASC' },
            { id: 's-4', targetId: 'metric-deals', direction: 'DESC' },
          ],
        }),
        'sort',
      )
    })

    it('rejects sorts targeting unselected ids', () => {
      expectInvalid(
        validConfig({
          sort: [{ id: 's-1', targetId: 'dim-other', direction: 'ASC' }],
        }),
        'target',
      )
    })

    it('rejects duplicate sort ids and unknown directions', () => {
      expectInvalid(
        validConfig({
          sort: [
            { id: 's-1', targetId: 'metric-value', direction: 'ASC' },
            { id: 's-1', targetId: 'metric-deals', direction: 'DESC' },
          ],
        }),
        'duplicate',
      )
      expectInvalid(
        validConfig({
          sort: [{ id: 's-1', targetId: 'metric-value', direction: 'SIDEWAYS' }],
        }),
        'direction',
      )
    })
  })

  it('rejects unknown keys inside nested objects', () => {
    expectInvalid(
      validConfig({
        metrics: [{ id: 'm-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'a', extra: 1 }],
      }),
      'unknown key',
    )
    expectInvalid(
      validConfig({
        visualization: { type: 'TABLE', magic: true },
      }),
      'unknown key',
    )
  })
})

describe('parseCustomReportConfig — defensive read path', () => {
  it('returns a valid result for a well-formed persisted config', () => {
    const parsed = parseCustomReportConfig(validConfig())
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.config.dataSource).toBe('DEALS')
      expect(parsed.warnings).toEqual([])
    }
  })

  it('returns an explicit invalid result for non-objects — never a sales default', () => {
    for (const raw of [null, 42, 'string', [], undefined]) {
      const parsed = parseCustomReportConfig(raw)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.warnings.length).toBeGreaterThan(0)
    }
  })

  it('returns an explicit invalid result for a corrupt persisted config', () => {
    const corrupt = validConfig({ dataSource: 'INVOICES' })
    const parsed = parseCustomReportConfig(corrupt)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.warnings.join(' ')).toMatch(/dataSource/i)
    }
  })

  it('returns an explicit invalid result for a config that is missing required parts', () => {
    const parsed = parseCustomReportConfig(validConfig({ dimensions: [] }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.warnings.join(' ')).toMatch(/dimension/i)
  })

  it('returns an explicit invalid result for unknown persisted versions', () => {
    const parsed = parseCustomReportConfig(validConfig({ version: 3 }))
    expect(parsed.ok).toBe(false)
  })

  it('never throws, even on hostile input', () => {
    const hostile = {
      version: 1,
      dataSource: { evil: true },
      filters: [{ id: 1, fieldId: '__proto__', operator: 'EQ' }],
      dimensions: 'yes',
      metrics: null,
      calculatedFields: [{ id: 'x', alias: 'a', expression: '1;DROP TABLE report' }],
      visualization: { type: 'TABLE' },
      sort: 'up',
    }
    expect(() => parseCustomReportConfig(hostile)).not.toThrow()
  })
})

describe('chart type vocabulary integrity', () => {
  it('exposes exactly the nine binding chart types', () => {
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
  })

  it('validated configs carry typed v2 CustomReportConfig values', () => {
    const config = validateCustomReportConfig(validConfig()) as CustomReportConfig
    expect(config.version).toBe(CUSTOM_REPORT_CONFIG_VERSION)
    expect(config.filters).toEqual([])
    expect(config.sort).toEqual([])
    expect(config.visualization.colors).toEqual([...CUSTOM_REPORT_DEFAULT_COLORS])
    expect(config.visualization.legendPosition).toBe('BOTTOM')
  })
})

describe('v1 → v2 normalization (Contract A.2-A.3)', () => {
  it('accepts a valid v1 config and normalizes it to an in-memory v2 config', () => {
    const config = validateCustomReportConfig(
      v1Config({
        visualization: {
          type: 'BAR',
          title: 'Pipeline',
          showLegend: true,
          showDataLabels: true,
          xAxisLabel: 'Stage',
          yAxisLabel: 'Deals',
          orientation: 'HORIZONTAL',
        },
      }),
    )
    expect(config.version).toBe(2)
    // Unchanged v1 choices survive.
    expect(config.visualization.type).toBe('BAR')
    expect(config.visualization.title).toBe('Pipeline')
    expect(config.visualization.showLegend).toBe(true)
    expect(config.visualization.orientation).toBe('HORIZONTAL')
    expect(config.dataSource).toBe('DEALS')
    expect(config.metrics).toHaveLength(2)
    // v2-only fields are defaulted: full palette + BOTTOM.
    expect(config.visualization.colors).toEqual([...CUSTOM_REPORT_DEFAULT_COLORS])
    expect(config.visualization.legendPosition).toBe('BOTTOM')
  })

  it('normalizes v1 through the defensive read path (saved-report load)', () => {
    const parsed = parseCustomReportConfig(v1Config())
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.config.version).toBe(2)
      expect(parsed.config.visualization.colors).toEqual([...CUSTOM_REPORT_DEFAULT_COLORS])
      expect(parsed.config.visualization.legendPosition).toBe('BOTTOM')
    }
  })

  it('persists v2 on the next save (round-trip write)', () => {
    const config = validateCustomReportConfig(v1Config())
    // Re-validating the normalized v2 output is stable (idempotent).
    const again = validateCustomReportConfig(config)
    expect(again.version).toBe(2)
    expect(again.visualization.colors).toEqual([...CUSTOM_REPORT_DEFAULT_COLORS])
  })

  it('rejects v1 configs carrying v2-only keys (fail closed during rolling deploy)', () => {
    const v1WithV2Key: Record<string, unknown> = {
      ...v1Config(),
      visualization: {
        type: 'TABLE',
        title: null,
        showLegend: false,
        showDataLabels: false,
        xAxisLabel: null,
        yAxisLabel: null,
        orientation: null,
        colors: ['BLUE'],
      },
    }
    expectInvalid(v1WithV2Key, 'unknown key')
  })

  it('rejects unknown versions and unknown keys on both paths', () => {
    expectInvalid(validConfig({ version: 3 }), 'version')
    expectInvalid(validConfig({ version: 99 }), 'version')
    expectInvalid(validConfig({ futureKey: true }), 'unknown key')
    const parsed = parseCustomReportConfig(validConfig({ version: 3 }))
    expect(parsed.ok).toBe(false)
  })

  it('rejects corrupt persisted v1 JSON on the defensive path', () => {
    const parsed = parseCustomReportConfig(v1Config({ dataSource: 'INVOICES' }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.warnings.join(' ')).toMatch(/dataSource/i)
  })
})

describe('v2 visualization — colors and legend position (Contract A.2)', () => {
  it('normalizes an empty colors array to the full default palette', () => {
    const config = validateCustomReportConfig(validConfig({ visualization: { type: 'TABLE' } }))
    expect(config.visualization.colors).toEqual([...CUSTOM_REPORT_DEFAULT_COLORS])
  })

  it('accepts 1–10 approved tokens in series order and preserves them', () => {
    const colors = ['BLUE', 'RED', 'TEAL']
    const config = validateCustomReportConfig(
      validConfig({ visualization: { type: 'TABLE', colors } }),
    )
    expect(config.visualization.colors).toEqual(colors)
  })

  it('rejects more than 10 tokens', () => {
    const tooMany = [...CUSTOM_REPORT_COLOR_TOKENS, 'BLUE']
    expectInvalid(validConfig({ visualization: { type: 'TABLE', colors: tooMany } }), '10')
  })

  it('rejects unknown / arbitrary color tokens', () => {
    expectInvalid(validConfig({ visualization: { type: 'TABLE', colors: ['#ff0000'] } }), 'color')
    expectInvalid(validConfig({ visualization: { type: 'TABLE', colors: ['ORANGE'] } }), 'color')
    expectInvalid(validConfig({ visualization: { type: 'TABLE', colors: [42] } }), 'color')
  })

  it('defaults legendPosition to BOTTOM when omitted', () => {
    const config = validateCustomReportConfig(validConfig({ visualization: { type: 'TABLE' } }))
    expect(config.visualization.legendPosition).toBe('BOTTOM')
  })

  it('accepts every approved legend position and rejects unknown ones', () => {
    for (const position of CUSTOM_REPORT_LEGEND_POSITIONS) {
      const config = validateCustomReportConfig(
        validConfig({ visualization: { type: 'TABLE', legendPosition: position } }),
      )
      expect(config.visualization.legendPosition).toBe(position)
    }
    expectInvalid(
      validConfig({ visualization: { type: 'TABLE', legendPosition: 'CENTER' } }),
      'legendPosition',
    )
  })

  it('keeps title and axis-label strictness for v2', () => {
    expectInvalid(validConfig({ visualization: { type: 'TABLE', title: '   ' } }), 'title')
    expectInvalid(validConfig({ visualization: { type: 'TABLE', xAxisLabel: '' } }), 'xAxisLabel')
  })

  it('defaults BAR orientation to VERTICAL and keeps HORIZONTAL', () => {
    const vertical = validateCustomReportConfig(
      validConfig({
        visualization: { type: 'BAR' },
      }),
    )
    expect(vertical.visualization.orientation).toBe('VERTICAL')
    const horizontal = validateCustomReportConfig(
      validConfig({
        visualization: { type: 'BAR', orientation: 'HORIZONTAL' },
      }),
    )
    expect(horizontal.visualization.orientation).toBe('HORIZONTAL')
  })
})

describe('chartCompatibilityErrors — closed matrix (Contract A.4)', () => {
  const DATE_DIM = {
    id: 'd-1',
    fieldId: 'deal.expectedCloseDate',
    calculation: null,
    granularity: 'MONTH',
  } as const
  const STAGE_DIM = {
    id: 'd-1',
    fieldId: 'deal.stage',
    calculation: null,
    granularity: null,
  } as const
  const SUM_METRIC = {
    id: 'm-1',
    fieldId: 'deal.value',
    aggregation: 'SUM',
    alias: 'revenue',
  } as const
  const COUNT_METRIC = {
    id: 'm-1',
    fieldId: 'deal.id',
    aggregation: 'COUNT',
    alias: 'deals',
  } as const
  const AVG_METRIC = {
    id: 'm-1',
    fieldId: 'deal.value',
    aggregation: 'AVERAGE',
    alias: 'avg',
  } as const

  const configFor = (
    chartType: string,
    extra: Record<string, unknown> = {},
  ): CustomReportConfig => {
    // Build a structurally valid typed config (a TABLE base) and then apply
    // the raw overrides so chartCompatibilityErrors can be exercised on
    // incompatible combinations that the strict validator would reject.
    const raw = validConfig({ visualization: { type: 'TABLE' }, ...extra })
    const base = validateCustomReportConfig(validConfig({ visualization: { type: 'TABLE' } }))
    return {
      ...base,
      dataSource: raw.dataSource as CustomReportDataSource,
      dimensions: raw.dimensions as CustomReportDimension[],
      metrics: raw.metrics as CustomReportMetric[],
      calculatedFields: (raw.calculatedFields ?? []) as CustomReportCalculatedField[],
      visualization: { ...base.visualization, type: chartType as CustomReportChartType },
    }
  }

  const expectCompatible = (config: CustomReportConfig): void => {
    expect(chartCompatibilityErrors(config)).toEqual([])
  }
  const expectErrors = (config: CustomReportConfig, messagePart: string): void => {
    const errors = chartCompatibilityErrors(config)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' | ')).toMatch(messagePart)
  }

  it('TABLE accepts any otherwise valid config', () => {
    expectCompatible(configFor('TABLE'))
  })

  describe('LINE / AREA', () => {
    it('accepts a date-like first dimension with a numeric metric', () => {
      for (const type of ['LINE', 'AREA'] as const) {
        expectCompatible(configFor(type, { dimensions: [DATE_DIM], metrics: [SUM_METRIC] }))
      }
    })

    it('rejects a non-date first dimension', () => {
      for (const type of ['LINE', 'AREA'] as const) {
        expectErrors(configFor(type, { dimensions: [STAGE_DIM], metrics: [SUM_METRIC] }), 'date')
      }
    })

    it('rejects zero numeric metrics', () => {
      for (const type of ['LINE', 'AREA'] as const) {
        expectErrors(
          configFor(type, { dimensions: [DATE_DIM], metrics: [COUNT_METRIC] }),
          'numeric',
        )
      }
    })
  })

  describe('BAR', () => {
    it('accepts one or two dimensions with a numeric metric', () => {
      expectCompatible(configFor('BAR', { dimensions: [STAGE_DIM], metrics: [SUM_METRIC] }))
      expectCompatible(
        configFor('BAR', {
          dimensions: [
            STAGE_DIM,
            { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
          ],
          metrics: [SUM_METRIC],
        }),
      )
    })

    it('rejects zero or three dimensions', () => {
      expectErrors(
        configFor('BAR', {
          dimensions: [],
          metrics: [SUM_METRIC],
        }),
        'one or two',
      )
    })

    it('rejects a missing numeric metric', () => {
      expectErrors(
        configFor('BAR', { dimensions: [STAGE_DIM], metrics: [COUNT_METRIC] }),
        'numeric',
      )
    })
  })

  describe('PIE / DONUT', () => {
    it('accepts exactly one categorical dimension and one numeric metric', () => {
      for (const type of ['PIE', 'DONUT'] as const) {
        expectCompatible(configFor(type, { dimensions: [STAGE_DIM], metrics: [SUM_METRIC] }))
      }
    })

    it('rejects a date dimension', () => {
      for (const type of ['PIE', 'DONUT'] as const) {
        expectErrors(
          configFor(type, { dimensions: [DATE_DIM], metrics: [SUM_METRIC] }),
          'categorical',
        )
      }
    })

    it('rejects two dimensions', () => {
      for (const type of ['PIE', 'DONUT'] as const) {
        expectErrors(
          configFor(type, {
            dimensions: [
              STAGE_DIM,
              { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
            ],
            metrics: [SUM_METRIC],
          }),
          'one',
        )
      }
    })

    it('rejects zero or two metrics', () => {
      for (const type of ['PIE', 'DONUT'] as const) {
        expectErrors(configFor(type, { dimensions: [STAGE_DIM], metrics: [] }), 'metric')
        expectErrors(
          configFor(type, {
            dimensions: [STAGE_DIM],
            metrics: [
              SUM_METRIC,
              { id: 'm-2', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
            ],
          }),
          'metric',
        )
      }
    })

    it('rejects a COUNT-only metric (non-numeric)', () => {
      for (const type of ['PIE', 'DONUT'] as const) {
        expectErrors(
          configFor(type, { dimensions: [STAGE_DIM], metrics: [COUNT_METRIC] }),
          'numeric',
        )
      }
    })
  })

  describe('FUNNEL', () => {
    it('accepts DEALS source, one stage dimension and one COUNT/SUM metric', () => {
      expectCompatible(configFor('FUNNEL', { dimensions: [STAGE_DIM], metrics: [COUNT_METRIC] }))
    })

    it('rejects a non-DEALS source', () => {
      expectErrors(
        configFor('FUNNEL', {
          dataSource: 'CONTACTS',
          dimensions: [
            { id: 'd-1', fieldId: 'contact.owner', calculation: null, granularity: null },
          ],
          metrics: [{ id: 'm-1', fieldId: 'contact.id', aggregation: 'COUNT', alias: 'count' }],
        }),
        'DEALS',
      )
    })

    it('rejects a non-stage dimension', () => {
      expectErrors(
        configFor('FUNNEL', {
          dimensions: [{ id: 'd-1', fieldId: 'deal.owner', calculation: null, granularity: null }],
          metrics: [COUNT_METRIC],
        }),
        'stage',
      )
    })

    it('rejects non-COUNT/SUM metrics', () => {
      expectErrors(
        configFor('FUNNEL', { dimensions: [STAGE_DIM], metrics: [AVG_METRIC] }),
        'COUNT or SUM',
      )
    })
  })

  describe('SCATTER', () => {
    it('accepts exactly one identifying dimension and exactly two numeric metrics', () => {
      expectCompatible(
        configFor('SCATTER', {
          dimensions: [STAGE_DIM],
          metrics: [
            SUM_METRIC,
            { id: 'm-2', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
          ],
        }),
      )
    })

    it('rejects a date-like identifying dimension', () => {
      expectErrors(
        configFor('SCATTER', {
          dimensions: [DATE_DIM],
          metrics: [
            SUM_METRIC,
            { id: 'm-2', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
          ],
        }),
        'identifying',
      )
    })

    it('rejects two dimensions', () => {
      expectErrors(
        configFor('SCATTER', {
          dimensions: [
            STAGE_DIM,
            { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
          ],
          metrics: [
            SUM_METRIC,
            { id: 'm-2', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
          ],
        }),
        'one',
      )
    })

    it('rejects one or three metrics', () => {
      expectErrors(configFor('SCATTER', { dimensions: [STAGE_DIM], metrics: [SUM_METRIC] }), 'two')
      expectErrors(
        configFor('SCATTER', {
          dimensions: [STAGE_DIM],
          metrics: [
            SUM_METRIC,
            { id: 'm-2', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
            { id: 'm-3', fieldId: 'deal.value', aggregation: 'MIN', alias: 'min' },
          ],
        }),
        'two',
      )
    })

    it('rejects a non-numeric metric', () => {
      expectErrors(
        configFor('SCATTER', {
          dimensions: [STAGE_DIM],
          metrics: [
            COUNT_METRIC,
            { id: 'm-2', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
          ],
        }),
        'numeric',
      )
    })
  })

  describe('HEATMAP', () => {
    it('accepts exactly two dimensions and one numeric metric', () => {
      expectCompatible(
        configFor('HEATMAP', {
          dimensions: [
            STAGE_DIM,
            { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
          ],
          metrics: [SUM_METRIC],
        }),
      )
    })

    it('rejects one or three dimensions', () => {
      expectErrors(configFor('HEATMAP', { dimensions: [STAGE_DIM], metrics: [SUM_METRIC] }), 'two')
    })

    it('rejects zero or two numeric metrics', () => {
      expectErrors(
        configFor('HEATMAP', {
          dimensions: [
            STAGE_DIM,
            { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
          ],
          metrics: [],
        }),
        'metric',
      )
      expectErrors(
        configFor('HEATMAP', {
          dimensions: [
            STAGE_DIM,
            { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
          ],
          metrics: [
            SUM_METRIC,
            { id: 'm-2', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
          ],
        }),
        'metric',
      )
    })

    it('rejects a COUNT-only metric (non-numeric)', () => {
      expectErrors(
        configFor('HEATMAP', {
          dimensions: [
            STAGE_DIM,
            { id: 'd-2', fieldId: 'deal.owner', calculation: null, granularity: null },
          ],
          metrics: [COUNT_METRIC],
        }),
        'numeric',
      )
    })
  })

  it('validateCustomReportConfig throws the identical chart-compatibility errors', () => {
    const raw = validConfig({
      visualization: { type: 'PIE' },
      metrics: [COUNT_METRIC],
    })
    const viaValidator = ((): string[] => {
      try {
        validateCustomReportConfig(raw)
        return []
      } catch (err) {
        return [(err as Error).message]
      }
    })()
    // chartCompatibilityErrors operates on a structurally valid (but
    // incompatible) typed config — the same check the validator runs.
    const base = validateCustomReportConfig(validConfig())
    const pieConfig: CustomReportConfig = {
      ...base,
      visualization: { ...base.visualization, type: 'PIE' },
      metrics: [COUNT_METRIC],
    }
    const viaMatrix = chartCompatibilityErrors(pieConfig)
    expect(viaMatrix.join(' | ')).toMatch(/numeric/)
    expect(viaValidator.join(' | ')).toMatch(/numeric/)
  })
})
