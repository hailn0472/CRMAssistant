/**
 * Story 6.4 (Contract A.1) — closed v2 chart/legend/color vocabularies.
 * The backend const tuples are the single source of truth; Pothos enums and
 * the frontend derive from them. No hand-copied parallel vocabulary.
 */
import {
  CUSTOM_REPORT_CHART_TYPES,
  CUSTOM_REPORT_COLOR_TOKEN_HEX,
  CUSTOM_REPORT_COLOR_TOKENS,
  CUSTOM_REPORT_DEFAULT_COLORS,
  CUSTOM_REPORT_LEGEND_POSITIONS,
  isCustomReportChartType,
  isCustomReportColorToken,
  isCustomReportLegendPosition,
} from '../custom-report-types'

describe('CustomReportChartType vocabulary (v2)', () => {
  it('exposes the nine closed chart types including the four deferred ones', () => {
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

  it('guards every chart type and rejects unknown values', () => {
    for (const value of CUSTOM_REPORT_CHART_TYPES) {
      expect(isCustomReportChartType(value)).toBe(true)
    }
    expect(isCustomReportChartType('DOUGHNUT')).toBe(false)
    expect(isCustomReportChartType(42)).toBe(false)
    expect(isCustomReportChartType(undefined)).toBe(false)
  })
})

describe('CustomReportLegendPosition vocabulary', () => {
  it('is a closed TOP | RIGHT | BOTTOM | LEFT tuple', () => {
    expect(CUSTOM_REPORT_LEGEND_POSITIONS).toEqual(['TOP', 'RIGHT', 'BOTTOM', 'LEFT'])
  })

  it('guards positions and rejects unknown values', () => {
    for (const value of CUSTOM_REPORT_LEGEND_POSITIONS) {
      expect(isCustomReportLegendPosition(value)).toBe(true)
    }
    expect(isCustomReportLegendPosition('CENTER')).toBe(false)
    expect(isCustomReportLegendPosition(null)).toBe(false)
  })
})

describe('CustomReportColorToken vocabulary', () => {
  it('is a closed 10-token tuple mapped to the approved shared chart palette', () => {
    expect(CUSTOM_REPORT_COLOR_TOKENS).toHaveLength(10)
    // The approved 10-color chart palette (CustomReportPreview CHART_COLORS family).
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.BLUE).toBe('#2563eb')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.VIOLET).toBe('#7c3aed')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.GREEN).toBe('#059669')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.AMBER).toBe('#d97706')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.RED).toBe('#dc2626')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.CYAN).toBe('#0891b2')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.PINK).toBe('#db2777')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.LIME).toBe('#65a30d')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.INDIGO).toBe('#4f46e5')
    expect(CUSTOM_REPORT_COLOR_TOKEN_HEX.TEAL).toBe('#0f766e')
  })

  it('every token has exactly one approved hex and no duplicate hexes', () => {
    const hexes = CUSTOM_REPORT_COLOR_TOKENS.map((token) => CUSTOM_REPORT_COLOR_TOKEN_HEX[token])
    expect(new Set(hexes).size).toBe(CUSTOM_REPORT_COLOR_TOKENS.length)
    for (const hex of hexes) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('the default palette is the full token tuple in series order', () => {
    expect(CUSTOM_REPORT_DEFAULT_COLORS).toEqual([...CUSTOM_REPORT_COLOR_TOKENS])
  })

  it('guards tokens and rejects arbitrary CSS colors', () => {
    for (const value of CUSTOM_REPORT_COLOR_TOKENS) {
      expect(isCustomReportColorToken(value)).toBe(true)
    }
    expect(isCustomReportColorToken('#ff0000')).toBe(false)
    expect(isCustomReportColorToken('ORANGE')).toBe(false)
    expect(isCustomReportColorToken('')).toBe(false)
  })
})
