/**
 * Story 6.6 (Contract C16): pure closed server chart-artifact renderer.
 *
 * Consumes ONLY typed series/config (`ReportDocumentChartSeries` +
 * `ReportDocumentVisualization`) and emits a fixed-dimension sanitized SVG
 * with a closed palette, then rasterizes it to PNG via the direct dependency
 * `@resvg/resvg-js`. No scripts, no foreignObject, no external URLs, no user
 * HTML, no DOM/canvas/Puppeteer. A TABLE report yields no image.
 */
import { Resvg } from '@resvg/resvg-js'

import type {
  ReportDocumentChartSeries,
  ReportDocumentVisualization,
} from './report-document-payload'

export const CHART_WIDTH = 800
export const CHART_HEIGHT = 400
export const CHART_IMAGE_WIDTH = 380
export const CHART_IMAGE_HEIGHT = 180

/** Closed fallback palette — hex only, validated before use. */
const FALLBACK_PALETTE = [
  '#2563eb',
  '#7c3aed',
  '#059669',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#4f46e5',
  '#0f766e',
]

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

function safeColor(value: string | undefined, index: number): string {
  if (typeof value === 'string' && HEX_PATTERN.test(value)) return value.toLowerCase()
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length]!
}

/** XML-escape user text — labels can never inject markup into the SVG. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 100) / 100)
}

type ChartInput = {
  visualization: ReportDocumentVisualization
  series: ReportDocumentChartSeries[]
}

function isTableLike(input: ChartInput): boolean {
  return input.visualization.type === 'TABLE' || input.series.length === 0
}

function seriesColors(input: ChartInput, seriesIndex: number, pointIndex = 0): string {
  return safeColor(
    input.visualization.colors[
      (seriesIndex + pointIndex) % Math.max(input.visualization.colors.length, 1)
    ],
    seriesIndex + pointIndex,
  )
}

function labelSafe(value: string, max = 16): string {
  const short = value.length > max ? `${value.slice(0, max - 1)}…` : value
  return escapeXml(short)
}

function chartTitle(input: ChartInput): string {
  const title = input.visualization.title?.trim()
  if (!title) return ''
  return `<text x="400" y="24" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#1f2937">${escapeXml(title)}</text>`
}

// ─── Cartesian (LINE / AREA / BAR / SCATTER / FUNNEL) ────────────────────────

function cartesianSvg(
  input: ChartInput,
  kind: 'LINE' | 'AREA' | 'BAR' | 'SCATTER' | 'FUNNEL',
): string {
  const pad = { top: 44, right: 20, bottom: 52, left: 64 }
  const plotW = CHART_WIDTH - pad.left - pad.right
  const plotH = CHART_HEIGHT - pad.top - pad.bottom
  const allPoints = input.series.flatMap((s) => s.points)
  const labels = [...new Set(allPoints.map((p) => p.label))]
  const values = allPoints.map((p) => p.value ?? 0)
  const maxValue = Math.max(0, ...values)
  const minValue = Math.min(0, ...values)
  const range = maxValue - minValue || 1

  const xFor = (index: number, count: number): number =>
    count <= 1 ? pad.left + plotW / 2 : pad.left + (index * plotW) / Math.max(count - 1, 1)
  const yFor = (value: number): number => pad.top + plotH - ((value - minValue) / range) * plotH

  const parts: string[] = []

  // Grid + axis labels
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4
    const val = maxValue - (range * i) / 4
    parts.push(
      `<line x1="${pad.left}" y1="${y}" x2="${CHART_WIDTH - pad.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`,
    )
    parts.push(
      `<text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#6b7280">${formatNumber(val)}</text>`,
    )
  }
  labels.forEach((label, i) => {
    const x = xFor(i, labels.length)
    parts.push(
      `<text x="${x}" y="${CHART_HEIGHT - 16}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#6b7280">${labelSafe(label)}</text>`,
    )
  })
  if (input.visualization.xAxisLabel) {
    parts.push(
      `<text x="${pad.left + plotW / 2}" y="${CHART_HEIGHT - 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#374151">${escapeXml(input.visualization.xAxisLabel)}</text>`,
    )
  }
  if (input.visualization.yAxisLabel) {
    parts.push(
      `<text x="14" y="${pad.top + plotH / 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#374151" transform="rotate(-90 14 ${pad.top + plotH / 2})">${escapeXml(input.visualization.yAxisLabel)}</text>`,
    )
  }

  const seriesCount = Math.max(input.series.length, 1)
  input.series.forEach((series, si) => {
    const color = safeColor(input.visualization.colors[si], si)
    const points = series.points.map((p, pi) => ({
      x: xFor(pi, series.points.length),
      y: yFor(p.value ?? 0),
      value: p.value,
      label: p.label,
      pi,
    }))

    if (kind === 'LINE' || kind === 'AREA') {
      const coords = points.map((p) => `${p.x},${p.y}`).join(' ')
      if (kind === 'AREA') {
        const first = points[0]
        const last = points[points.length - 1]
        if (first && last) {
          const polygon = `${first.x},${pad.top + plotH} ${coords} ${last.x},${pad.top + plotH}`
          parts.push(
            `<polygon points="${polygon}" fill="${color}" fill-opacity="0.25" stroke="none"/>`,
          )
        }
      }
      parts.push(
        `<polyline points="${coords}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
      )
      for (const p of points) {
        parts.push(
          `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}" stroke="#ffffff" stroke-width="1"/>`,
        )
      }
    } else if (kind === 'BAR') {
      const groupW = plotW / Math.max(series.points.length, 1)
      const barW = Math.max(4, (groupW / seriesCount) * 0.7)
      points.forEach((p) => {
        const x =
          p.x - (groupW / 2) * (1 - (seriesCount - 1) * 0.15) + si * (groupW / seriesCount) * 0.7
        const y = p.value !== null && p.value >= 0 ? p.y : pad.top + plotH
        const h = Math.max(1, Math.abs(p.y - (pad.top + plotH)))
        parts.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}"/>`)
      })
    } else if (kind === 'SCATTER') {
      for (const p of points) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="5" fill="${color}" fill-opacity="0.85"/>`)
      }
    } else if (kind === 'FUNNEL') {
      const n = Math.max(points.length, 1)
      const stepH = plotH / n
      points.forEach((p, pi) => {
        const frac = n === 0 ? 0 : (n - pi) / n
        const halfW = (plotW / 2) * (0.95 - (pi / Math.max(n, 1)) * 0.6)
        const yTop = pad.top + pi * stepH
        const yBottom = pad.top + (pi + 1) * stepH
        parts.push(
          `<polygon points="${pad.left + plotW / 2 - halfW},${yTop} ${pad.left + plotW / 2 + halfW},${yTop} ${pad.left + plotW / 2 + halfW * frac},${yBottom} ${pad.left + plotW / 2 - halfW * frac},${yBottom}" fill="${color}"/>`,
        )
        if (input.visualization.showDataLabels) {
          parts.push(
            `<text x="${pad.left + plotW / 2}" y="${yTop + stepH / 2 + 4}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#ffffff">${labelSafe(p.label, 12)}</text>`,
          )
        }
      })
    }
  })

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
  <rect x="0" y="0" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#ffffff"/>
  ${chartTitle(input)}
  ${parts.join('\n')}
  ${legendSvg(input)}
</svg>`
}

// ─── PIE / DONUT ─────────────────────────────────────────────────────────────

function polarSvg(input: ChartInput, donut: boolean): string {
  const cx = CHART_WIDTH / 2
  const cy = CHART_HEIGHT / 2 + 10
  const r = Math.min(CHART_WIDTH, CHART_HEIGHT) / 2 - 60
  const innerR = donut ? r * 0.55 : 0
  const points = input.series[0]?.points ?? []
  const total = points.reduce((acc, p) => acc + Math.max(p.value ?? 0, 0), 0)
  const parts: string[] = []

  let angle = -Math.PI / 2
  points.forEach((p, i) => {
    const value = Math.max(p.value ?? 0, 0)
    const sweep =
      total > 0 ? (value / total) * Math.PI * 2 : (Math.PI * 2) / Math.max(points.length, 1)
    const startAngle = angle
    const endAngle = angle + sweep
    const color = seriesColors(input, i)

    if (donut) {
      const largeArc = sweep > Math.PI ? 1 : 0
      const outer = {
        x1: cx + r * Math.cos(startAngle),
        y1: cy + r * Math.sin(startAngle),
        x2: cx + r * Math.cos(endAngle),
        y2: cy + r * Math.sin(endAngle),
      }
      const inner = {
        x1: cx + innerR * Math.cos(endAngle),
        y1: cy + innerR * Math.sin(endAngle),
        x2: cx + innerR * Math.cos(startAngle),
        y2: cy + innerR * Math.sin(startAngle),
      }
      const d = [
        `M ${outer.x1} ${outer.y1}`,
        `A ${r} ${r} 0 ${largeArc} 1 ${outer.x2} ${outer.y2}`,
        `L ${inner.x1} ${inner.y1}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${inner.x2} ${inner.y2}`,
        'Z',
      ].join(' ')
      parts.push(`<path d="${d}" fill="${color}" stroke="#ffffff" stroke-width="1"/>`)
    } else {
      const largeArc = sweep > Math.PI ? 1 : 0
      const x2 = cx + r * Math.cos(endAngle)
      const y2 = cy + r * Math.sin(endAngle)
      const d = [
        `M ${cx} ${cy}`,
        `L ${cx + r * Math.cos(startAngle)} ${cy + r * Math.sin(startAngle)}`,
        `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
        'Z',
      ].join(' ')
      parts.push(`<path d="${d}" fill="${color}" stroke="#ffffff" stroke-width="1"/>`)
    }
    if (input.visualization.showDataLabels && total > 0) {
      const mid = startAngle + sweep / 2
      const lx = cx + r * 0.7 * Math.cos(mid)
      const ly = cy + r * 0.7 * Math.sin(mid)
      parts.push(
        `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#ffffff">${Math.round((value / total) * 100)}%</text>`,
      )
    }
    angle = endAngle
  })

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
  <rect x="0" y="0" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#ffffff"/>
  ${chartTitle(input)}
  ${parts.join('\n')}
  ${legendSvg(input)}
</svg>`
}

// ─── HEATMAP ─────────────────────────────────────────────────────────────────

function heatmapSvg(input: ChartInput): string {
  const series = input.series[0]?.points ?? []
  const cols = Math.max(series.length, 1)
  const pad = { top: 44, right: 20, bottom: 44, left: 20 }
  const plotW = CHART_WIDTH - pad.left - pad.right
  const plotH = CHART_HEIGHT - pad.top - pad.bottom
  const rows = input.series.length
  const cellW = plotW / cols
  const cellH = plotH / Math.max(rows, 1)
  const values = series.map((p) => p.value ?? 0)
  const maxValue = Math.max(0, ...values) || 1
  const parts: string[] = []

  input.series.forEach((s, si) => {
    s.points.forEach((p, pi) => {
      const intensity = Math.max(0, Math.min(1, (p.value ?? 0) / maxValue))
      const color = safeColor(input.visualization.colors[Math.min(pi, 9)], pi)
      parts.push(
        `<rect x="${pad.left + pi * cellW}" y="${pad.top + si * cellH}" width="${cellW - 2}" height="${cellH - 2}" fill="${color}" fill-opacity="${(0.25 + intensity * 0.75).toFixed(2)}"/>`,
      )
    })
    parts.push(
      `<text x="${pad.left - 4}" y="${pad.top + si * cellH + cellH / 2 + 4}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#374151">${labelSafe(s.label, 10)}</text>`,
    )
  })
  series.forEach((p, pi) => {
    parts.push(
      `<text x="${pad.left + pi * cellW + cellW / 2}" y="${CHART_HEIGHT - 14}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#6b7280">${labelSafe(p.label, 10)}</text>`,
    )
  })

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
  <rect x="0" y="0" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#ffffff"/>
  ${chartTitle(input)}
  ${parts.join('\n')}
</svg>`
}

function legendSvg(input: ChartInput): string {
  if (!input.visualization.showLegend) return ''
  const items = input.series.flatMap((s) =>
    s.points.slice(0, 1).map((p) => ({
      label: s.label || p.label,
      color: safeColor(undefined, input.series.indexOf(s)),
    })),
  )
  if (items.length === 0) return ''
  const parts: string[] = []
  items.slice(0, 8).forEach((item, i) => {
    const x = CHART_WIDTH - 40 - items.length * 110 + i * 110
    parts.push(`<rect x="${Math.max(x, 10)}" y="18" width="10" height="10" fill="${item.color}"/>`)
    parts.push(
      `<text x="${Math.max(x, 10) + 14}" y="27" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#374151">${labelSafe(item.label, 12)}</text>`,
    )
  })
  return parts.join('\n')
}

// ─── Public surface ──────────────────────────────────────────────────────────

/** Emits the closed sanitized SVG for a non-TABLE chart (throws for TABLE). */
export function renderChartSvg(input: ChartInput): string {
  if (isTableLike(input)) {
    throw new Error('TABLE reports have no server chart artifact')
  }
  switch (input.visualization.type) {
    case 'LINE':
      return cartesianSvg(input, 'LINE')
    case 'AREA':
      return cartesianSvg(input, 'AREA')
    case 'BAR':
      return cartesianSvg(input, 'BAR')
    case 'SCATTER':
      return cartesianSvg(input, 'SCATTER')
    case 'FUNNEL':
      return cartesianSvg(input, 'FUNNEL')
    case 'PIE':
      return polarSvg(input, false)
    case 'DONUT':
      return polarSvg(input, true)
    case 'HEATMAP':
      return heatmapSvg(input)
    default:
      // Unknown closed vocabulary → treat as a table-like report: no image.
      throw new Error(`Unsupported chart type: ${input.visualization.type}`)
  }
}

/**
 * Rasterizes the closed SVG to a PNG via @resvg/resvg-js. Pure CPU raster;
 * no browser, no network. Returns a PNG buffer (magic bytes 89 50 4E 47).
 */
export async function renderChartPng(input: ChartInput): Promise<Buffer> {
  const svg = renderChartSvg(input)
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CHART_WIDTH },
    background: '#ffffff',
  })
  const rendered = resvg.render()
  return Buffer.from(rendered.asPng())
}

/** Convenience: render PNG for a payload's visualization+series (null for TABLE). */
export async function chartPngForPayload(payload: {
  visualization: ReportDocumentVisualization | null
  chartSeries: ReportDocumentChartSeries[]
}): Promise<Buffer | null> {
  if (!payload.visualization || payload.visualization.type === 'TABLE') return null
  if (payload.chartSeries.length === 0) return null
  try {
    return await renderChartPng({
      visualization: payload.visualization,
      series: payload.chartSeries,
    })
  } catch {
    return null // never let a chart failure block the whole export
  }
}
