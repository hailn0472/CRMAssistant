/**
 * Story 6.4 (Contract B) — pure framework-free chart data transformations.
 *
 * Converts CustomReportResult into a strongly-typed NormalizedReportChart
 * discriminated union. Handles multi-series joins, zero/negative domains,
 * percentage rounding, funnel conversion calculations, cumulative area sums,
 * scatter correlation pairs, heatmap intensity normalizations, sr-only tables,
 * and strict validation without mutating input data.
 */
import type {
  CustomReportColorToken,
  CustomReportLegendPosition,
  CustomReportOrientation,
  CustomReportResult,
} from '@/services/custom-report.service'
import { CUSTOM_REPORT_DEFAULT_COLORS } from '@/services/custom-report.service'

export interface ScreenReaderTable {
  headers: string[]
  rows: string[][]
}

export interface BaseNormalizedChart {
  title: string | null
  showLegend: boolean
  showDataLabels: boolean
  colors: CustomReportColorToken[]
  legendPosition: CustomReportLegendPosition
  srTable: ScreenReaderTable
  totalPoints: number
  datasetKey?: string
}

export interface NormalizedLineSeries {
  metricId: string
  label: string
}

export interface NormalizedLinePoint {
  key: string
  label: string
  dimensionLabels: string[]
  values: Record<string, number | null>
}

export interface NormalizedLineChart extends BaseNormalizedChart {
  type: 'LINE'
  xAxisLabel: string | null
  yAxisLabel: string | null
  series: NormalizedLineSeries[]
  points: NormalizedLinePoint[]
}

export interface NormalizedBarChart extends BaseNormalizedChart {
  type: 'BAR'
  orientation: CustomReportOrientation
  xAxisLabel: string | null
  yAxisLabel: string | null
  series: NormalizedLineSeries[]
  points: NormalizedLinePoint[]
}

export interface NormalizedPieSlice {
  key: string
  label: string
  value: number
  percentage: number
  dimensionLabels: string[]
  metricId: string
}

export interface NormalizedPieChart extends BaseNormalizedChart {
  type: 'PIE' | 'DONUT'
  isDonut: boolean
  metricId: string
  metricLabel: string
  total: number
  slices: NormalizedPieSlice[]
}

export interface NormalizedFunnelStage {
  key: string
  stageName: string
  value: number
  previousConversionRate: number | null
  overallConversionRate: number | null
  dimensionLabels: string[]
  metricId: string
}

export interface NormalizedFunnelChart extends BaseNormalizedChart {
  type: 'FUNNEL'
  metricId: string
  metricLabel: string
  stages: NormalizedFunnelStage[]
}

export interface NormalizedAreaPoint {
  key: string
  label: string
  dimensionLabels: string[]
  values: Record<string, number> // cumulative running total
  rawValues: Record<string, number | null>
}

export interface NormalizedAreaChart extends BaseNormalizedChart {
  type: 'AREA'
  xAxisLabel: string | null
  yAxisLabel: string | null
  series: NormalizedLineSeries[]
  points: NormalizedAreaPoint[]
}

export interface NormalizedScatterPoint {
  key: string
  label: string
  dimensionLabels: string[]
  x: number
  y: number
}

export interface NormalizedScatterChart extends BaseNormalizedChart {
  type: 'SCATTER'
  xMetric: { metricId: string; label: string }
  yMetric: { metricId: string; label: string }
  xAxisLabel: string | null
  yAxisLabel: string | null
  points: NormalizedScatterPoint[]
}

export interface NormalizedHeatmapCell {
  key: string
  xLabel: string
  yLabel: string
  intensity: number
  normalizedIntensity: number // 0..1 scale
  dimensionLabels: string[]
  metricId: string
}

export interface NormalizedHeatmapChart extends BaseNormalizedChart {
  type: 'HEATMAP'
  xLabels: string[]
  yLabels: string[]
  metricId: string
  metricLabel: string
  minIntensity: number
  maxIntensity: number
  cells: NormalizedHeatmapCell[]
}

export interface NormalizedTableChart extends BaseNormalizedChart {
  type: 'TABLE'
  rawResult: CustomReportResult
}

export type NormalizedReportChart =
  | NormalizedLineChart
  | NormalizedBarChart
  | NormalizedPieChart
  | NormalizedFunnelChart
  | NormalizedAreaChart
  | NormalizedScatterChart
  | NormalizedHeatmapChart
  | NormalizedTableChart

export function normalizeReportChart(result: CustomReportResult): NormalizedReportChart {
  const vis = result.config.visualization
  const chartType = vis.type
  const title = vis.title
  const showLegend = vis.showLegend
  const showDataLabels = vis.showDataLabels
  const colors =
    vis.colors && vis.colors.length > 0 ? vis.colors : [...CUSTOM_REPORT_DEFAULT_COLORS]
  const legendPosition = vis.legendPosition ?? 'BOTTOM'
  const datasetKey = result.generatedAt

  // Validate non-finite and duplicates across all series, plus series length consistency
  if (result.series.length > 0) {
    const firstSeriesLen = result.series[0].points.length
    for (const s of result.series) {
      if (s.points.length !== firstSeriesLen) {
        throw new Error(
          `Inconsistent series lengths detected: series "${s.metricId}" has ${s.points.length} points, expected ${firstSeriesLen}`,
        )
      }
      const seenKeys = new Set<string>()
      for (const p of s.points) {
        if (seenKeys.has(p.key)) {
          throw new Error(`Duplicate series point key detected: ${p.key}`)
        }
        seenKeys.add(p.key)
        if (p.value !== null && !Number.isFinite(p.value)) {
          throw new Error(`Non-finite value detected in series point: ${p.value}`)
        }
      }
    }
  }

  if (chartType === 'TABLE') {
    return {
      type: 'TABLE',
      title,
      showLegend,
      showDataLabels,
      colors,
      legendPosition,
      rawResult: result,
      totalPoints: result.totalRows,
      datasetKey,
      srTable: {
        headers: result.columns.map((c) => c.label),
        rows: result.rows.map((r) =>
          r.cells.map((c) => {
            if (c.isNull) return '—'
            if (c.stringValue !== null) return c.stringValue
            if (c.numberValue !== null) return String(c.numberValue)
            if (c.booleanValue !== null) return String(c.booleanValue)
            if (c.dateValue !== null) return c.dateValue
            return '—'
          }),
        ),
      },
    }
  }

  if (chartType === 'LINE' || chartType === 'BAR') {
    const seriesList: NormalizedLineSeries[] = result.series.map((s) => ({
      metricId: s.metricId,
      label: s.label,
    }))

    // Collect all unique keys across all series to form the reference joined key set
    const allKeys = new Set<string>()
    for (const s of result.series) {
      for (const p of s.points) {
        allKeys.add(p.key)
      }
    }

    // Verify every series contains every key (no missing keys) and consistent dimensionLabels
    const pointDimensionLabelsMap = new Map<string, string[]>()
    for (const s of result.series) {
      const seriesKeys = new Set(s.points.map((p) => p.key))
      for (const key of allKeys) {
        if (!seriesKeys.has(key)) {
          throw new Error(`Missing key "${key}" in series "${s.metricId}"`)
        }
      }
      for (const p of s.points) {
        const dimLabels = p.dimensionLabels ?? [p.label]
        const existing = pointDimensionLabelsMap.get(p.key)
        if (existing) {
          if (
            existing.length !== dimLabels.length ||
            !existing.every((lbl, i) => lbl === dimLabels[i])
          ) {
            throw new Error(
              `Mismatched dimension labels for key "${p.key}" across series: [${existing.join(', ')}] vs [${dimLabels.join(', ')}]`,
            )
          }
        } else {
          pointDimensionLabelsMap.set(p.key, dimLabels)
        }
      }
    }

    // Join series by point key using ordered points from first series (or first available)
    const pointsMap = new Map<
      string,
      { label: string; dimensionLabels: string[]; values: Record<string, number | null> }
    >()
    const orderedKeys: string[] = []

    for (const s of result.series) {
      for (const p of s.points) {
        if (!pointsMap.has(p.key)) {
          pointsMap.set(p.key, {
            label: p.label,
            dimensionLabels: p.dimensionLabels ?? [p.label],
            values: {},
          })
          orderedKeys.push(p.key)
        }
        const pt = pointsMap.get(p.key)!
        pt.values[s.metricId] = p.value
      }
    }

    const points: NormalizedLinePoint[] = orderedKeys.map((key) => {
      const entry = pointsMap.get(key)!
      return {
        key,
        label: entry.label,
        dimensionLabels: entry.dimensionLabels,
        values: entry.values,
      }
    })

    const srHeaders = ['Dimension', ...seriesList.map((s) => s.label)]
    const srRows = points.map((pt) => [
      pt.label,
      ...seriesList.map((s) => {
        const val = pt.values[s.metricId]
        return val === null ? '—' : String(val)
      }),
    ])

    if (chartType === 'LINE') {
      return {
        type: 'LINE',
        title,
        showLegend,
        showDataLabels,
        colors,
        legendPosition,
        xAxisLabel: vis.xAxisLabel,
        yAxisLabel: vis.yAxisLabel,
        series: seriesList,
        points,
        totalPoints: points.length,
        datasetKey,
        srTable: { headers: srHeaders, rows: srRows },
      }
    }

    return {
      type: 'BAR',
      orientation: vis.orientation ?? 'VERTICAL',
      title,
      showLegend,
      showDataLabels,
      colors,
      legendPosition,
      xAxisLabel: vis.xAxisLabel,
      yAxisLabel: vis.yAxisLabel,
      series: seriesList,
      points,
      totalPoints: points.length,
      datasetKey,
      srTable: { headers: srHeaders, rows: srRows },
    }
  }

  if (chartType === 'PIE' || chartType === 'DONUT') {
    const firstSeries = result.series[0] ?? { metricId: 'metric', label: 'Value', points: [] }
    const validPoints = firstSeries.points.map((p) => ({
      key: p.key,
      label: p.label,
      value: Math.max(0, p.value ?? 0),
      dimensionLabels: p.dimensionLabels ?? [p.label],
    }))

    const total = validPoints.reduce((acc, p) => acc + p.value, 0)
    const slices: NormalizedPieSlice[] = validPoints.map((p) => {
      const pct = total > 0 ? (p.value / total) * 100 : 0
      return {
        key: p.key,
        label: p.label,
        value: p.value,
        percentage: Number(pct.toFixed(1)),
        dimensionLabels: p.dimensionLabels,
        metricId: firstSeries.metricId,
      }
    })

    const srHeaders = ['Category', firstSeries.label, 'Percentage']
    const srRows = slices.map((s) => [s.label, String(s.value), `${s.percentage.toFixed(1)}%`])

    return {
      type: chartType,
      isDonut: chartType === 'DONUT',
      title,
      showLegend,
      showDataLabels,
      colors,
      legendPosition,
      metricId: firstSeries.metricId,
      metricLabel: firstSeries.label,
      total,
      slices,
      totalPoints: slices.length,
      datasetKey,
      srTable: { headers: srHeaders, rows: srRows },
    }
  }

  if (chartType === 'FUNNEL') {
    const firstSeries = result.series[0] ?? { metricId: 'metric', label: 'Count', points: [] }
    const topValue = firstSeries.points[0]?.value ?? null

    const stages: NormalizedFunnelStage[] = firstSeries.points.map((p, idx, arr) => {
      const val = Math.max(0, p.value ?? 0)
      const prevVal = idx > 0 ? arr[idx - 1].value ?? null : val

      let prevRate: number | null = null
      if (prevVal !== null && prevVal > 0) {
        prevRate = Number(((val / prevVal) * 100).toFixed(1))
      }

      let overallRate: number | null = null
      if (topValue !== null && topValue > 0) {
        overallRate = Number(((val / topValue) * 100).toFixed(1))
      }

      return {
        key: p.key,
        stageName: p.label,
        value: val,
        previousConversionRate: prevRate,
        overallConversionRate: overallRate,
        dimensionLabels: p.dimensionLabels ?? [p.label],
        metricId: firstSeries.metricId,
      }
    })

    const srHeaders = ['Stage', firstSeries.label, 'vs Previous', 'vs Overall']
    const srRows = stages.map((st) => [
      st.stageName,
      String(st.value),
      st.previousConversionRate !== null ? `${st.previousConversionRate}%` : '—',
      st.overallConversionRate !== null ? `${st.overallConversionRate}%` : '—',
    ])

    return {
      type: 'FUNNEL',
      title,
      showLegend,
      showDataLabels,
      colors,
      legendPosition,
      metricId: firstSeries.metricId,
      metricLabel: firstSeries.label,
      stages,
      totalPoints: stages.length,
      datasetKey,
      srTable: { headers: srHeaders, rows: srRows },
    }
  }

  if (chartType === 'AREA') {
    const seriesList: NormalizedLineSeries[] = result.series.map((s) => ({
      metricId: s.metricId,
      label: s.label,
    }))

    // Collect all unique keys across all series to form the reference joined key set
    const allKeys = new Set<string>()
    for (const s of result.series) {
      for (const p of s.points) {
        allKeys.add(p.key)
      }
    }

    // Verify every series contains every key (no missing keys) and consistent dimensionLabels
    const pointDimensionLabelsMap = new Map<string, string[]>()
    for (const s of result.series) {
      const seriesKeys = new Set(s.points.map((p) => p.key))
      for (const key of allKeys) {
        if (!seriesKeys.has(key)) {
          throw new Error(`Missing key "${key}" in series "${s.metricId}"`)
        }
      }
      for (const p of s.points) {
        const dimLabels = p.dimensionLabels ?? [p.label]
        const existing = pointDimensionLabelsMap.get(p.key)
        if (existing) {
          if (
            existing.length !== dimLabels.length ||
            !existing.every((lbl, i) => lbl === dimLabels[i])
          ) {
            throw new Error(
              `Mismatched dimension labels for key "${p.key}" across series: [${existing.join(', ')}] vs [${dimLabels.join(', ')}]`,
            )
          }
        } else {
          pointDimensionLabelsMap.set(p.key, dimLabels)
        }
      }
    }

    // Cumulative calculation per metric across server ordered points
    const runningTotals: Record<string, number> = {}
    for (const s of seriesList) runningTotals[s.metricId] = 0

    // Build series-keyed map of points: metricId -> (key -> point)
    const seriesPointMap = new Map<string, Map<string, (typeof result.series)[0]['points'][0]>>()
    for (const s of result.series) {
      const map = new Map<string, (typeof result.series)[0]['points'][0]>()
      for (const p of s.points) {
        map.set(p.key, p)
      }
      seriesPointMap.set(s.metricId, map)
    }

    const firstSeries = result.series[0] ?? { points: [] }
    const points: NormalizedAreaPoint[] = firstSeries.points.map((fp) => {
      const values: Record<string, number> = {}
      const rawValues: Record<string, number | null> = {}

      for (const s of result.series) {
        const pt = seriesPointMap.get(s.metricId)?.get(fp.key)
        const raw = pt ? pt.value : null
        rawValues[s.metricId] = raw
        if (raw !== null) {
          runningTotals[s.metricId] += raw
        }
        values[s.metricId] = runningTotals[s.metricId]
      }

      return {
        key: fp.key,
        label: fp.label,
        dimensionLabels: fp.dimensionLabels ?? [fp.label],
        values,
        rawValues,
      }
    })

    const srHeaders = ['Dimension', ...seriesList.map((s) => `${s.label} (Cumulative)`)]
    const srRows = points.map((pt) => [
      pt.label,
      ...seriesList.map((s) => String(pt.values[s.metricId])),
    ])

    return {
      type: 'AREA',
      title,
      showLegend,
      showDataLabels,
      colors,
      legendPosition,
      xAxisLabel: vis.xAxisLabel,
      yAxisLabel: vis.yAxisLabel,
      series: seriesList,
      points,
      totalPoints: points.length,
      datasetKey,
      srTable: { headers: srHeaders, rows: srRows },
    }
  }

  if (chartType === 'SCATTER') {
    if (result.series.length < 2) {
      throw new Error('Scatter plots require at least 2 metric series')
    }
    const xSeries = result.series[0] ?? { metricId: 'x', label: 'X', points: [] }
    const ySeries = result.series[1] ?? { metricId: 'y', label: 'Y', points: [] }

    // Collect all unique keys across both series
    const allKeys = new Set<string>()
    for (const p of xSeries.points) allKeys.add(p.key)
    for (const p of ySeries.points) allKeys.add(p.key)

    const xKeys = new Set(xSeries.points.map((p) => p.key))
    const yKeys = new Set(ySeries.points.map((p) => p.key))

    for (const key of allKeys) {
      if (!xKeys.has(key)) {
        throw new Error(`Missing key "${key}" in series "${xSeries.metricId}"`)
      }
      if (!yKeys.has(key)) {
        throw new Error(`Missing key "${key}" in series "${ySeries.metricId}"`)
      }
    }

    // Verify dimension labels match across x and y series
    const yMap = new Map<string, number | null>()
    const yDimMap = new Map<string, string[]>()
    for (const yp of ySeries.points) {
      yMap.set(yp.key, yp.value)
      yDimMap.set(yp.key, yp.dimensionLabels ?? [yp.label])
    }

    const points: NormalizedScatterPoint[] = []
    for (const xp of xSeries.points) {
      const xDim = xp.dimensionLabels ?? [xp.label]
      const yDim = yDimMap.get(xp.key)
      if (yDim && (yDim.length !== xDim.length || !yDim.every((lbl, i) => lbl === xDim[i]))) {
        throw new Error(
          `Mismatched dimension labels for key "${xp.key}" across series: [${xDim.join(', ')}] vs [${yDim.join(', ')}]`,
        )
      }
      const yVal = yMap.get(xp.key)
      if (xp.value !== null && yVal !== undefined && yVal !== null) {
        points.push({
          key: xp.key,
          label: xp.label,
          dimensionLabels: xDim,
          x: xp.value,
          y: yVal,
        })
      }
    }

    const srHeaders = ['Item', xSeries.label, ySeries.label]
    const srRows = points.map((p) => [p.label, String(p.x), String(p.y)])

    return {
      type: 'SCATTER',
      title,
      showLegend,
      showDataLabels,
      colors,
      legendPosition,
      xMetric: { metricId: xSeries.metricId, label: xSeries.label },
      yMetric: { metricId: ySeries.metricId, label: ySeries.label },
      xAxisLabel: vis.xAxisLabel ?? xSeries.label,
      yAxisLabel: vis.yAxisLabel ?? ySeries.label,
      points,
      totalPoints: points.length,
      datasetKey,
      srTable: { headers: srHeaders, rows: srRows },
    }
  }

  if (chartType === 'HEATMAP') {
    const firstSeries = result.series[0] ?? { metricId: 'metric', label: 'Intensity', points: [] }
    const xLabelsSet = new Set<string>()
    const yLabelsSet = new Set<string>()

    const rawCells = firstSeries.points.map((p) => {
      const xLabel = p.dimensionLabels?.[0] ?? p.label
      const yLabel = p.dimensionLabels?.[1] ?? ''
      xLabelsSet.add(xLabel)
      if (yLabel) yLabelsSet.add(yLabel)
      return {
        key: p.key,
        xLabel,
        yLabel,
        intensity: p.value ?? 0,
        dimensionLabels: p.dimensionLabels ?? [xLabel, yLabel],
        metricId: firstSeries.metricId,
      }
    })

    const intensities = rawCells.map((c) => c.intensity)
    const minIntensity = intensities.length > 0 ? Math.min(...intensities) : 0
    const maxIntensity = intensities.length > 0 ? Math.max(...intensities) : 0
    const range = maxIntensity - minIntensity

    const cells: NormalizedHeatmapCell[] = rawCells.map((c) => ({
      ...c,
      normalizedIntensity: range > 0 ? (c.intensity - minIntensity) / range : 0.5,
    }))

    const xLabels = Array.from(xLabelsSet)
    const yLabels = Array.from(yLabelsSet)

    const srHeaders = ['Dimension 1', 'Dimension 2', firstSeries.label]
    const srRows = cells.map((c) => [c.xLabel, c.yLabel, String(c.intensity)])

    return {
      type: 'HEATMAP',
      title,
      showLegend,
      showDataLabels,
      colors,
      legendPosition,
      xLabels,
      yLabels,
      metricId: firstSeries.metricId,
      metricLabel: firstSeries.label,
      minIntensity,
      maxIntensity,
      cells,
      totalPoints: cells.length,
      datasetKey,
      srTable: { headers: srHeaders, rows: srRows },
    }
  }

  throw new Error(`Unsupported chart type: ${chartType}`)
}
