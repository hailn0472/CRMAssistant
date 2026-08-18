import { normalizeReportChart } from '../report-chart'
import type { CustomReportResult } from '@/services/custom-report.service'

describe('report-chart pure transformations (Contract B, AC 5-11, 18)', () => {
  const baseResult: CustomReportResult = {
    reportId: 'rep-1',
    generatedAt: '2026-08-16T12:00:00.000Z',
    config: {
      version: 2,
      dataSource: 'DEALS',
      filters: [],
      dimensions: [
        { id: 'dim-1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
      ],
      metrics: [{ id: 'met-1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }],
      calculatedFields: [],
      visualization: {
        type: 'LINE',
        title: 'Monthly Revenue',
        showLegend: true,
        showDataLabels: true,
        xAxisLabel: 'Month',
        yAxisLabel: 'Revenue ($)',
        orientation: null,
        colors: ['BLUE', 'VIOLET'],
        legendPosition: 'BOTTOM',
      },
      sort: [],
    },
    columns: [],
    rows: [],
    totalRows: 2,
    series: [
      {
        metricId: 'met-1',
        label: 'Revenue',
        points: [
          { key: '2026-01', label: 'Jan 2026', value: 1000, dimensionLabels: ['Jan 2026'] },
          { key: '2026-02', label: 'Feb 2026', value: 1500, dimensionLabels: ['Feb 2026'] },
        ],
      },
    ],
    warnings: [],
    pagination: { page: 1, pageSize: 20, totalPages: 1 },
    truncated: false,
  }

  describe('LINE transformation (AC 5)', () => {
    it('joins multiple numeric series by key preserving server ordering', () => {
      const multiSeriesResult: CustomReportResult = {
        ...baseResult,
        series: [
          {
            metricId: 'met-1',
            label: 'Revenue',
            points: [
              { key: '2026-01', label: 'Jan 2026', value: 1000, dimensionLabels: ['Jan 2026'] },
              { key: '2026-02', label: 'Feb 2026', value: 1500, dimensionLabels: ['Feb 2026'] },
            ],
          },
          {
            metricId: 'met-2',
            label: 'Target',
            points: [
              { key: '2026-01', label: 'Jan 2026', value: 800, dimensionLabels: ['Jan 2026'] },
              { key: '2026-02', label: 'Feb 2026', value: 1200, dimensionLabels: ['Feb 2026'] },
            ],
          },
        ],
      }

      const normalized = normalizeReportChart(multiSeriesResult)
      expect(normalized.type).toBe('LINE')
      if (normalized.type === 'LINE') {
        expect(normalized.series).toHaveLength(2)
        expect(normalized.series[0].label).toBe('Revenue')
        expect(normalized.series[1].label).toBe('Target')
        expect(normalized.points).toHaveLength(2)
        expect(normalized.points[0].values['met-1']).toBe(1000)
        expect(normalized.points[0].values['met-2']).toBe(800)
        expect(normalized.srTable.headers).toEqual(['Dimension', 'Revenue', 'Target'])
        expect(normalized.srTable.rows).toEqual([
          ['Jan 2026', '1000', '800'],
          ['Feb 2026', '1500', '1200'],
        ])
      }
    })

    it('handles null values as gaps in srTable and values', () => {
      const resultWithNull: CustomReportResult = {
        ...baseResult,
        series: [
          {
            metricId: 'met-1',
            label: 'Revenue',
            points: [
              { key: '2026-01', label: 'Jan 2026', value: null, dimensionLabels: ['Jan 2026'] },
            ],
          },
        ],
      }
      const normalized = normalizeReportChart(resultWithNull)
      if (normalized.type === 'LINE') {
        expect(normalized.points[0].values['met-1']).toBeNull()
        expect(normalized.srTable.rows[0][1]).toBe('—')
      }
    })
  })

  describe('BAR transformation (AC 6)', () => {
    it('normalizes single-dimension and 2-dimension composite labels with vertical/horizontal orientation', () => {
      const barResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'BAR',
            orientation: 'HORIZONTAL',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Revenue',
            points: [
              {
                key: 'north:won',
                label: 'North - Won',
                value: 5000,
                dimensionLabels: ['North', 'Won'],
              },
            ],
          },
        ],
      }

      const normalized = normalizeReportChart(barResult)
      expect(normalized.type).toBe('BAR')
      if (normalized.type === 'BAR') {
        expect(normalized.orientation).toBe('HORIZONTAL')
        expect(normalized.points[0].dimensionLabels).toEqual(['North', 'Won'])
        expect(normalized.points[0].values['met-1']).toBe(5000)
      }
    })
  })

  describe('PIE & DONUT transformation (AC 7)', () => {
    it('computes rounded percentage = value / sum(non-negative) * 100', () => {
      const pieResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'PIE',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Deals by Stage',
            points: [
              { key: 's1', label: 'Lead', value: 30, dimensionLabels: ['Lead'] },
              { key: 's2', label: 'Proposal', value: 70, dimensionLabels: ['Proposal'] },
            ],
          },
        ],
      }

      const normalized = normalizeReportChart(pieResult)
      expect(normalized.type).toBe('PIE')
      if (normalized.type === 'PIE') {
        expect(normalized.isDonut).toBe(false)
        expect(normalized.total).toBe(100)
        expect(normalized.slices[0].percentage).toBe(30)
        expect(normalized.slices[1].percentage).toBe(70)
        expect(normalized.srTable.rows).toEqual([
          ['Lead', '30', '30.0%'],
          ['Proposal', '70', '70.0%'],
        ])
      }
    })

    it('handles zero total without division by zero error', () => {
      const pieResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'DONUT',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Zero slice',
            points: [{ key: 's1', label: 'Lead', value: 0, dimensionLabels: ['Lead'] }],
          },
        ],
      }
      const normalized = normalizeReportChart(pieResult)
      expect(normalized.type).toBe('DONUT')
      if (normalized.type === 'DONUT') {
        expect(normalized.isDonut).toBe(true)
        expect(normalized.total).toBe(0)
        expect(normalized.slices[0].percentage).toBe(0)
      }
    })
  })

  describe('FUNNEL transformation (AC 8)', () => {
    it('computes stage order and previous + overall conversion rates', () => {
      const funnelResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'FUNNEL',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Deal Funnel',
            points: [
              { key: 'st-1', label: 'Lead', value: 100, dimensionLabels: ['Lead'] },
              { key: 'st-2', label: 'Qualified', value: 50, dimensionLabels: ['Qualified'] },
              { key: 'st-3', label: 'Closed Won', value: 25, dimensionLabels: ['Closed Won'] },
            ],
          },
        ],
      }

      const normalized = normalizeReportChart(funnelResult)
      expect(normalized.type).toBe('FUNNEL')
      if (normalized.type === 'FUNNEL') {
        expect(normalized.stages[0].previousConversionRate).toBe(100)
        expect(normalized.stages[0].overallConversionRate).toBe(100)
        expect(normalized.stages[1].previousConversionRate).toBe(50)
        expect(normalized.stages[1].overallConversionRate).toBe(50)
        expect(normalized.stages[2].previousConversionRate).toBe(50)
        expect(normalized.stages[2].overallConversionRate).toBe(25)
      }
    })

    it('handles zero denominators in funnel safely with null rates', () => {
      const funnelResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'FUNNEL',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Deal Funnel',
            points: [
              { key: 'st-1', label: 'Lead', value: 0, dimensionLabels: ['Lead'] },
              { key: 'st-2', label: 'Qualified', value: 0, dimensionLabels: ['Qualified'] },
            ],
          },
        ],
      }

      const normalized = normalizeReportChart(funnelResult)
      if (normalized.type === 'FUNNEL') {
        expect(normalized.stages[0].previousConversionRate).toBeNull()
        expect(normalized.stages[0].overallConversionRate).toBeNull()
        expect(normalized.stages[1].previousConversionRate).toBeNull()
        expect(normalized.stages[1].overallConversionRate).toBeNull()
      }
    })
  })

  describe('AREA transformation (AC 9)', () => {
    it('computes running cumulative totals across server order', () => {
      const areaResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'AREA',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Revenue',
            points: [
              { key: 'm1', label: 'Jan', value: 100, dimensionLabels: ['Jan'] },
              { key: 'm2', label: 'Feb', value: 150, dimensionLabels: ['Feb'] },
              { key: 'm3', label: 'Mar', value: null, dimensionLabels: ['Mar'] },
              { key: 'm4', label: 'Apr', value: 50, dimensionLabels: ['Apr'] },
            ],
          },
        ],
      }

      const normalized = normalizeReportChart(areaResult)
      expect(normalized.type).toBe('AREA')
      if (normalized.type === 'AREA') {
        expect(normalized.points[0].values['met-1']).toBe(100)
        expect(normalized.points[1].values['met-1']).toBe(250)
        expect(normalized.points[2].values['met-1']).toBe(250) // null contributes 0 to cumulative
        expect(normalized.points[2].rawValues['met-1']).toBeNull()
        expect(normalized.points[3].values['met-1']).toBe(300)
      }
    })
  })

  describe('SCATTER transformation (AC 10)', () => {
    it('joins exactly two numeric metrics into x and y coordinates preserving finite zero values', () => {
      const scatterResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'SCATTER',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Deal Value',
            points: [
              { key: 'd1', label: 'Acme Deal', value: 0, dimensionLabels: ['Acme Deal'] },
              { key: 'd2', label: 'Globex Deal', value: 500, dimensionLabels: ['Globex Deal'] },
            ],
          },
          {
            metricId: 'met-2',
            label: 'Probability',
            points: [
              { key: 'd1', label: 'Acme Deal', value: 20, dimensionLabels: ['Acme Deal'] },
              { key: 'd2', label: 'Globex Deal', value: 80, dimensionLabels: ['Globex Deal'] },
            ],
          },
        ],
      }

      const normalized = normalizeReportChart(scatterResult)
      expect(normalized.type).toBe('SCATTER')
      if (normalized.type === 'SCATTER') {
        expect(normalized.xMetric.label).toBe('Deal Value')
        expect(normalized.yMetric.label).toBe('Probability')
        expect(normalized.points[0].x).toBe(0)
        expect(normalized.points[0].y).toBe(20)
        expect(normalized.points[1].x).toBe(500)
        expect(normalized.points[1].y).toBe(80)
      }
    })
  })

  describe('HEATMAP transformation (AC 11)', () => {
    it('maps 2-dimension cells + intensity with deterministic min/max scale', () => {
      const heatmapResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'HEATMAP',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Activity Count',
            points: [
              { key: 'c1', label: 'Alice - Call', value: 10, dimensionLabels: ['Alice', 'Call'] },
              { key: 'c2', label: 'Alice - Email', value: 20, dimensionLabels: ['Alice', 'Email'] },
              { key: 'c3', label: 'Bob - Call', value: 30, dimensionLabels: ['Bob', 'Call'] },
            ],
          },
        ],
      }

      const normalized = normalizeReportChart(heatmapResult)
      expect(normalized.type).toBe('HEATMAP')
      if (normalized.type === 'HEATMAP') {
        expect(normalized.xLabels).toEqual(['Alice', 'Bob'])
        expect(normalized.yLabels).toEqual(['Call', 'Email'])
        expect(normalized.minIntensity).toBe(10)
        expect(normalized.maxIntensity).toBe(30)
        expect(normalized.cells[0].normalizedIntensity).toBe(0)
        expect(normalized.cells[2].normalizedIntensity).toBe(1)
      }
    })

    it('handles constant intensity domain without division by zero', () => {
      const heatmapResult: CustomReportResult = {
        ...baseResult,
        config: {
          ...baseResult.config,
          visualization: {
            ...baseResult.config.visualization,
            type: 'HEATMAP',
          },
        },
        series: [
          {
            metricId: 'met-1',
            label: 'Count',
            points: [{ key: 'c1', label: 'A - B', value: 5, dimensionLabels: ['A', 'B'] }],
          },
        ],
      }
      const normalized = normalizeReportChart(heatmapResult)
      if (normalized.type === 'HEATMAP') {
        expect(normalized.minIntensity).toBe(5)
        expect(normalized.maxIntensity).toBe(5)
        expect(normalized.cells[0].normalizedIntensity).toBe(0.5)
      }
    })
  })

  describe('defensive invariants & immutability (Contract B.8-B.10)', () => {
    it('does not mutate the input result object', () => {
      const original = JSON.parse(JSON.stringify(baseResult))
      normalizeReportChart(baseResult)
      expect(baseResult).toEqual(original)
    })

    it('rejects duplicate keys within the same series', () => {
      const dupResult: CustomReportResult = {
        ...baseResult,
        series: [
          {
            metricId: 'met-1',
            label: 'Rev',
            points: [
              { key: 'dup-1', label: 'Jan', value: 10, dimensionLabels: ['Jan'] },
              { key: 'dup-1', label: 'Jan', value: 20, dimensionLabels: ['Jan'] },
            ],
          },
        ],
      }
      expect(() => normalizeReportChart(dupResult)).toThrow(/duplicate/i)
    })

    it('rejects non-finite values like NaN or Infinity', () => {
      const invalidResult: CustomReportResult = {
        ...baseResult,
        series: [
          {
            metricId: 'met-1',
            label: 'Rev',
            points: [{ key: 'k-1', label: 'Jan', value: NaN, dimensionLabels: ['Jan'] }],
          },
        ],
      }
      expect(() => normalizeReportChart(invalidResult)).toThrow(/non-finite/i)
    })

    it('rejects inconsistent series lengths', () => {
      const mismatchedLengthsResult: CustomReportResult = {
        ...baseResult,
        series: [
          {
            metricId: 'met-1',
            label: 'Rev',
            points: [
              { key: 'k-1', label: 'Jan', value: 100, dimensionLabels: ['Jan'] },
              { key: 'k-2', label: 'Feb', value: 200, dimensionLabels: ['Feb'] },
            ],
          },
          {
            metricId: 'met-2',
            label: 'Target',
            points: [{ key: 'k-1', label: 'Jan', value: 90, dimensionLabels: ['Jan'] }],
          },
        ],
      }
      expect(() => normalizeReportChart(mismatchedLengthsResult)).toThrow(
        /inconsistent series lengths/i,
      )
    })

    it('rejects missing keys across series in multi-series joins', () => {
      const missingKeyResult: CustomReportResult = {
        ...baseResult,
        series: [
          {
            metricId: 'met-1',
            label: 'Rev',
            points: [
              { key: 'k-1', label: 'Jan', value: 100, dimensionLabels: ['Jan'] },
              { key: 'k-2', label: 'Feb', value: 200, dimensionLabels: ['Feb'] },
            ],
          },
          {
            metricId: 'met-2',
            label: 'Target',
            points: [
              { key: 'k-1', label: 'Jan', value: 90, dimensionLabels: ['Jan'] },
              { key: 'k-3', label: 'Mar', value: 150, dimensionLabels: ['Mar'] },
            ],
          },
        ],
      }
      expect(() => normalizeReportChart(missingKeyResult)).toThrow(/missing key/i)
    })

    it('rejects mismatched dimension labels for the same key across series', () => {
      const mismatchedDimsResult: CustomReportResult = {
        ...baseResult,
        series: [
          {
            metricId: 'met-1',
            label: 'Rev',
            points: [{ key: 'k-1', label: 'Jan', value: 100, dimensionLabels: ['Jan 2026'] }],
          },
          {
            metricId: 'met-2',
            label: 'Target',
            points: [{ key: 'k-1', label: 'Jan', value: 90, dimensionLabels: ['Jan 2025'] }],
          },
        ],
      }
      expect(() => normalizeReportChart(mismatchedDimsResult)).toThrow(
        /mismatched dimension labels/i,
      )
    })
  })
})
