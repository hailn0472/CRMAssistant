/**
 * Story 6.6 (Contract C16 + test-plan §7): pure closed server chart artifact
 * renderer — every shipped non-TABLE chart type emits sanitized fixed-size
 * SVG and rasterizes to a valid PNG. TABLE yields no image.
 */
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  escapeXml,
  renderChartPng,
  renderChartSvg,
  chartPngForPayload,
} from '../report-export-chart'
import type {
  ReportDocumentChartSeries,
  ReportDocumentVisualization,
} from '../report-document-payload'

const ALL_CHART_TYPES = [
  'LINE',
  'BAR',
  'PIE',
  'DONUT',
  'AREA',
  'FUNNEL',
  'SCATTER',
  'HEATMAP',
] as const

function series(
  metricId: string,
  label: string,
  values: (number | null)[],
): ReportDocumentChartSeries {
  return {
    metricId,
    label,
    points: values.map((value, i) => ({
      key: `p${i}`,
      label: `Point ${i}`,
      value,
      dimensionLabels: [`Point ${i}`],
    })),
  }
}

function viz(
  type: string,
  overrides: Partial<ReportDocumentVisualization> = {},
): ReportDocumentVisualization {
  return {
    type,
    title: 'Sales overview',
    showLegend: true,
    showDataLabels: false,
    xAxisLabel: 'Period',
    yAxisLabel: 'Value',
    orientation: 'VERTICAL',
    colors: ['#2563eb', '#7c3aed', '#059669'],
    legendPosition: 'BOTTOM',
    ...overrides,
  }
}

describe('report-export-chart', () => {
  it('emits closed fixed-dimension SVG for every shipped chart type', () => {
    for (const type of ALL_CHART_TYPES) {
      const svg = renderChartSvg({
        visualization: viz(type),
        series: [series('m', 'Value', [10, 20, 15])],
      })
      expect(svg).toContain(`width="${CHART_WIDTH}"`)
      expect(svg).toContain(`height="${CHART_HEIGHT}"`)
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(svg).not.toContain('<script')
      expect(svg).not.toContain('foreignObject')
      expect(svg).not.toContain('xlink:href')
      // Only the standard XML namespace; no external resource URLs.
      expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:\/\//)
      // Closed vocabulary: only whitelisted elements appear.
      const elements = [...svg.matchAll(/<([a-zA-Z]+)[\s/>]/g)].map((m) => m[1])
      const allowed = new Set([
        'svg',
        'rect',
        'line',
        'text',
        'polyline',
        'polygon',
        'circle',
        'path',
      ])
      for (const el of elements) {
        expect(allowed.has(el)).toBe(true)
      }
    }
  })

  it('supports sales bucket charts (single series BAR) and table-only reports', () => {
    const svg = renderChartSvg({
      visualization: viz('BAR'),
      series: [series('value', 'Value', [100, 200, 300])],
    })
    expect(svg).toContain('<rect')
    expect(() => renderChartSvg({ visualization: viz('TABLE'), series: [] })).toThrow(
      /no server chart artifact/,
    )
    expect(() => renderChartSvg({ visualization: viz('LINE'), series: [] })).toThrow(
      /no server chart artifact/,
    )
  })

  it('rasterizes to a valid PNG with @resvg/resvg-js', async () => {
    for (const type of ALL_CHART_TYPES) {
      const png = await renderChartPng({
        visualization: viz(type),
        series: [series('m', 'Value', [10, 20, 15])],
      })
      expect(png.subarray(0, 4).toString('hex')).toBe('89504e47')
      expect(png.length).toBeGreaterThan(100)
    }
  })

  it('returns null chart artifacts for TABLE payloads (never blocks export)', async () => {
    expect(await chartPngForPayload({ visualization: viz('TABLE'), chartSeries: [] })).toBeNull()
    expect(await chartPngForPayload({ visualization: null, chartSeries: [] })).toBeNull()
  })

  it('returns null instead of throwing when rasterization fails (unsupported type)', async () => {
    expect(
      await chartPngForPayload({
        visualization: { ...viz('LINE'), type: 'NOT_A_TYPE' } as never,
        chartSeries: [series('m', 'Value', [1, 2])],
      }),
    ).toBeNull()
  })

  it('supports single-point AREA and multi-series HEATMAP/legend paths', async () => {
    const single = renderChartSvg({
      visualization: viz('AREA'),
      series: [series('m', 'Value', [10])],
    })
    expect(single).toContain('<polyline')
    const heatmap = renderChartSvg({
      visualization: viz('HEATMAP'),
      series: [series('m1', 'North', [1, 2, 3]), series('m2', 'South', [3, 2, 1])],
    })
    expect(heatmap).toContain('<rect')
    const legend = renderChartSvg({
      visualization: viz('LINE', { showLegend: true }),
      series: [series('m1', 'North', [1, 2, 3]), series('m2', 'South', [3, 2, 1])],
    })
    expect(legend).toContain('North')
    expect(legend).toContain('South')
  })

  it('supports data labels on FUNNEL and PIE/DONUT charts', () => {
    const funnel = renderChartSvg({
      visualization: viz('FUNNEL', { showDataLabels: true }),
      series: [series('m', 'Value', [100, 60, 30])],
    })
    expect(funnel).toContain('<text')
    const pie = renderChartSvg({
      visualization: viz('PIE', { showDataLabels: true }),
      series: [series('m', 'Value', [100, 60, 30])],
    })
    expect(pie).toContain('%')
    const donut = renderChartSvg({
      visualization: viz('DONUT', { showDataLabels: true }),
      series: [series('m', 'Value', [100, 60, 30])],
    })
    expect(donut).toContain('%')
    expect(donut).toContain('A 77 77') // inner donut arc radius
  })

  it('handles negative bars, zero-value pies and non-finite numbers safely', () => {
    const bar = renderChartSvg({
      visualization: viz('BAR'),
      series: [series('m', 'Value', [10, -5, 3])],
    })
    expect(bar).toContain('<rect')
    const zeroPie = renderChartSvg({
      visualization: viz('PIE'),
      series: [series('m', 'Value', [0, 0, 0])],
    })
    expect(zeroPie).toContain('<path')
    const inf = renderChartSvg({
      visualization: viz('LINE'),
      series: [series('m', 'Value', [Number.POSITIVE_INFINITY, 1])],
    })
    expect(inf).toContain('0') // formatNumber never emits Infinity
    expect(inf).not.toContain('Infinity')
  })

  it('escapes user text so labels cannot inject markup', () => {
    expect(escapeXml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    const svg = renderChartSvg({
      visualization: viz('LINE'),
      series: [series('m', 'Vendor <b>X</b> & Co', [1, 2, 3])],
    })
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('<b>')
    expect(svg).toContain('&lt;b&gt;')
  })

  it('falls back to the closed palette for unknown colors', () => {
    const svg = renderChartSvg({
      visualization: viz('BAR', { colors: ['javascript:alert(1)', 'not-a-color'] }),
      series: [series('m', 'Value', [1, 2, 3])],
    })
    expect(svg).toMatch(/fill="#[0-9a-f]{6}"/)
    expect(svg).not.toContain('javascript:')
  })
})
