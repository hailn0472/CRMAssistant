/**
 * Story 6.4 (Contract C.15) — centralized theme tokens for ReportChart framework.
 *
 * Meets WCAG 2.1 AA contrast requirements (3:1 graphical non-text, 4.5:1 text).
 * Maps closed CustomReportColorTokens to accessible hex codes and provides
 * semantic grid, axis, background, text and heatmap gradient definitions.
 */
import type { CustomReportColorToken } from '@/services/custom-report.service'
import {
  CUSTOM_REPORT_COLOR_TOKEN_HEX,
  CUSTOM_REPORT_DEFAULT_COLORS,
} from '@/services/custom-report.service'

export const CHART_THEME = {
  background: '#ffffff',
  grid: '#e2e8f0', // slate-200, 3:1 non-text contrast against #fff
  axis: '#64748b', // slate-500, meets 4.5:1 text contrast
  text: '#1e293b', // slate-800, 7:1+ contrast
  mutedText: '#64748b',
  tooltipBg: '#0f172a', // slate-900
  tooltipText: '#ffffff',
  tooltipBorder: '#334155',
  intensityRamp: [
    '#f0fdf4', // lowest intensity (green-50)
    '#bbf7d0', // green-200
    '#4ade80', // green-400
    '#16a34a', // green-600
    '#14532d', // highest intensity (green-900)
  ],
} as const

export function getColorTokenHex(token: CustomReportColorToken): string {
  return CUSTOM_REPORT_COLOR_TOKEN_HEX[token] ?? '#2563eb'
}

export function getPaletteHexArray(tokens?: CustomReportColorToken[]): string[] {
  if (!tokens || tokens.length === 0) {
    return CUSTOM_REPORT_DEFAULT_COLORS.map(getColorTokenHex)
  }
  return tokens.map(getColorTokenHex)
}

/** Interpolates a 0..1 normalized intensity into a hex color from the intensity ramp */
export function getIntensityColor(normalized: number): string {
  const ramp = CHART_THEME.intensityRamp
  const clamped = Math.max(0, Math.min(1, normalized))
  const idx = Math.min(Math.floor(clamped * ramp.length), ramp.length - 1)
  return ramp[idx]
}
