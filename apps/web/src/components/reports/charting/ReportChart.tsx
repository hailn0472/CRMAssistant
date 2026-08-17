/**
 * Story 6.4 (Contract C) — Reusable ReportChart renderer component.
 *
 * Closed switch over NormalizedReportChart supporting all 8 chart types
 * using installed Recharts ^3.10.1 primitives. ResponsiveContainer (100%/100%),
 * zoom/pan bounded window, local legend toggling, keyboard drill equivalents,
 * accessible sr-only tables, and client-side PNG/SVG export.
 */
'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  FunnelChart,
  Funnel,
  LabelList,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import type {
  NormalizedReportChart,
  NormalizedLineChart,
  NormalizedBarChart,
  NormalizedPieChart,
  NormalizedFunnelChart,
  NormalizedAreaChart,
  NormalizedScatterChart,
  NormalizedHeatmapChart,
} from '@/lib/report-chart'
import { CHART_THEME, getPaletteHexArray, getIntensityColor } from './report-chart-theme'
import { ReportChartControls } from './ReportChartControls'
import { exportChartAsSvg, exportChartAsPng } from '@/lib/report-chart-export'

export interface DrillDownRequest {
  pointKey: string
  metricId: string
  label: string
}

type CustomTooltipProp = React.ComponentProps<typeof Tooltip>['content']

export interface ReportChartProps {
  chart: NormalizedReportChart
  onDrillDown?: (req: DrillDownRequest) => void
  hideControls?: boolean
  hideSrTable?: boolean
  minHeight?: number
  hideDrillMarksBar?: boolean
  ariaLabel?: string
  customTooltip?: CustomTooltipProp
}

const DEFAULT_WINDOW_SIZE = 30

export function ReportChart({
  chart,
  onDrillDown,
  hideControls = false,
  hideSrTable = false,
  minHeight = 360,
  hideDrillMarksBar = false,
  ariaLabel,
  customTooltip,
}: ReportChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Viewport window state (startIndex, endIndex)
  const totalPoints = chart.totalPoints
  const [windowSize, setWindowSize] = useState(() =>
    Math.min(DEFAULT_WINDOW_SIZE, totalPoints || DEFAULT_WINDOW_SIZE),
  )
  const [startIndex, setStartIndex] = useState(0)

  // Legend hidden series set (ephemeral local state)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  // Reset viewport & legend when chart type, points, or dataset identity change (Contract D.21)
  useEffect(() => {
    setStartIndex(0)
    setWindowSize(Math.min(DEFAULT_WINDOW_SIZE, totalPoints || DEFAULT_WINDOW_SIZE))
    setHiddenSeries(new Set())
  }, [chart.type, chart.datasetKey, totalPoints])

  const endIndex = Math.min(startIndex + windowSize, totalPoints)

  const canZoomIn = windowSize > 5 && totalPoints > 5
  const canZoomOut = windowSize < totalPoints
  const canPanPrev = startIndex > 0
  const canPanNext = endIndex < totalPoints
  const canReset = startIndex > 0 || windowSize < totalPoints || hiddenSeries.size > 0

  const handleZoomIn = () => {
    const nextSize = Math.max(5, Math.floor(windowSize * 0.7))
    setWindowSize(nextSize)
  }

  const handleZoomOut = () => {
    const nextSize = Math.min(totalPoints, Math.ceil(windowSize * 1.4))
    setWindowSize(nextSize)
    if (startIndex + nextSize > totalPoints) {
      setStartIndex(Math.max(0, totalPoints - nextSize))
    }
  }

  const handlePanPrev = () => {
    const step = Math.max(1, Math.floor(windowSize * 0.3))
    setStartIndex((prev) => Math.max(0, prev - step))
  }

  const handlePanNext = () => {
    const step = Math.max(1, Math.floor(windowSize * 0.3))
    setStartIndex((prev) => Math.min(totalPoints - windowSize, prev + step))
  }

  const handleReset = () => {
    setStartIndex(0)
    setWindowSize(Math.min(DEFAULT_WINDOW_SIZE, totalPoints || DEFAULT_WINDOW_SIZE))
    setHiddenSeries(new Set())
  }

  const toggleSeries = (key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        // Never allow hiding all series (bound by legend items length)
        const legendItemCount = getLegendItems(chart, palette).length
        if (next.size < legendItemCount - 1) {
          next.add(key)
        }
      }
      return next
    })
  }

  const palette = useMemo(() => getPaletteHexArray(chart.colors), [chart.colors])
  const legendItems = useMemo(() => getLegendItems(chart, palette), [chart, palette])

  const getSvgElement = (): SVGSVGElement | null => {
    if (!containerRef.current) return null
    return containerRef.current.querySelector('svg.recharts-surface')
  }

  const handleExportSvg = () => {
    exportChartAsSvg(getSvgElement(), chart.title, chart.type)
  }

  const handleExportPng = () => {
    exportChartAsPng(getSvgElement(), chart.title, chart.type)
  }

  // Render per-type Recharts implementations
  const renderChartBody = () => {
    switch (chart.type) {
      case 'LINE':
        return renderLineChart(
          chart,
          startIndex,
          endIndex,
          palette,
          hiddenSeries,
          onDrillDown,
          customTooltip,
        )
      case 'BAR':
        return renderBarChart(
          chart,
          startIndex,
          endIndex,
          palette,
          hiddenSeries,
          onDrillDown,
          customTooltip,
        )
      case 'PIE':
      case 'DONUT':
        return renderPieChart(
          chart,
          startIndex,
          endIndex,
          palette,
          hiddenSeries,
          onDrillDown,
          customTooltip,
        )
      case 'FUNNEL':
        return renderFunnelChart(
          chart,
          startIndex,
          endIndex,
          palette,
          hiddenSeries,
          onDrillDown,
          customTooltip,
        )
      case 'AREA':
        return renderAreaChart(
          chart,
          startIndex,
          endIndex,
          palette,
          hiddenSeries,
          onDrillDown,
          customTooltip,
        )
      case 'SCATTER':
        return renderScatterChart(chart, startIndex, endIndex, palette, onDrillDown, customTooltip)
      case 'HEATMAP':
        return renderHeatmapChart(chart, startIndex, endIndex, onDrillDown, customTooltip)
      case 'TABLE':
        return <div className="p-4 text-sm text-slate-600">Table view is rendered directly.</div>
      default:
        return null
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden"
      data-testid="report-chart-container"
    >
      {!hideControls && chart.type !== 'TABLE' && (
        <ReportChartControls
          startIndex={startIndex}
          endIndex={endIndex}
          totalPoints={totalPoints}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onPanPrevious={handlePanPrev}
          onPanNext={handlePanNext}
          onReset={handleReset}
          onExportSvg={handleExportSvg}
          onExportPng={handleExportPng}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          canPanPrev={canPanPrev}
          canPanNext={canPanNext}
          canReset={canReset}
        />
      )}

      {chart.title && (
        <div className="px-4 pt-3 text-sm font-semibold text-slate-800" data-testid="chart-title">
          {chart.title}
        </div>
      )}

      {/* Accessible Interactive Legend / Intensity Legend for Heatmap */}
      {chart.showLegend &&
        chart.type !== 'TABLE' &&
        (chart.type === 'HEATMAP' || legendItems.length > 0) && (
          <div
            className="flex flex-wrap items-center justify-center gap-2 px-4 py-2"
            role="toolbar"
            aria-label={
              chart.type === 'HEATMAP' ? 'Heatmap intensity legend' : 'Toggle series visibility'
            }
          >
            {chart.type === 'HEATMAP' ? (
              <div
                className="flex items-center gap-2 text-xs text-slate-600"
                data-testid="heatmap-intensity-legend"
                aria-label={`Intensity scale from ${chart.minIntensity} to ${chart.maxIntensity}`}
              >
                <span className="font-medium text-slate-500">{chart.minIntensity} (Min)</span>
                <div
                  className="h-3 w-32 rounded border border-slate-200"
                  style={{
                    background: `linear-gradient(to right, ${CHART_THEME.intensityRamp.join(', ')})`,
                  }}
                  role="img"
                  aria-label={`Gradient scale from min ${chart.minIntensity} to max ${chart.maxIntensity}`}
                />
                <span className="font-medium text-slate-500">{chart.maxIntensity} (Max)</span>
              </div>
            ) : (
              legendItems.map((item) => {
                const isHidden = hiddenSeries.has(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSeries(item.id)}
                    aria-pressed={!isHidden}
                    aria-label={`Toggle series ${item.label}`}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                      isHidden
                        ? 'border-slate-200 bg-slate-100 text-slate-400 line-through'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: isHidden ? '#94a3b8' : item.color }}
                    />
                    {item.label}
                  </button>
                )
              })
            )}
          </div>
        )}

      <div
        className="w-full relative"
        style={{ minHeight: `${minHeight}px`, height: `${minHeight}px` }}
        role="img"
        aria-label={ariaLabel ?? chart.title ?? `${chart.type} Chart`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {renderChartBody() as React.ReactElement}
        </ResponsiveContainer>
      </div>

      {/* Keyboard-accessible drill-down button equivalents */}
      {!hideDrillMarksBar && onDrillDown && chart.type !== 'TABLE' && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs bg-slate-50 flex flex-wrap gap-1 items-center">
          <span className="font-medium text-slate-500 mr-1">View underlying records:</span>
          {getVisibleDrillMarks(chart, startIndex, endIndex).map((mark) => (
            <button
              key={mark.pointKey}
              type="button"
              onClick={() => onDrillDown(mark)}
              className="rounded px-1.5 py-0.5 text-blue-700 hover:bg-blue-100 hover:underline focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {mark.label}
            </button>
          ))}
        </div>
      )}

      {/* sr-only semantic table for screen readers (AC 18 / WCAG 2.1) */}
      {!hideSrTable && (
        <div className="sr-only">
          <table>
            <caption>{chart.title ?? `${chart.type} Chart Data`}</caption>
            <thead>
              <tr>
                {chart.srTable.headers.map((h, i) => (
                  <th key={i} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.srTable.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function getLegendItems(
  chart: NormalizedReportChart,
  palette: string[],
): { id: string; label: string; color: string }[] {
  if (chart.type === 'LINE' || chart.type === 'BAR' || chart.type === 'AREA') {
    return chart.series.map((s, idx) => ({
      id: s.metricId,
      label: s.label,
      color: palette[idx % palette.length],
    }))
  }
  if (chart.type === 'PIE' || chart.type === 'DONUT') {
    return chart.slices.map((s, idx) => ({
      id: s.key,
      label: s.label,
      color: palette[idx % palette.length],
    }))
  }
  if (chart.type === 'FUNNEL') {
    return chart.stages.map((st, idx) => ({
      id: st.key,
      label: st.stageName,
      color: palette[idx % palette.length],
    }))
  }
  return []
}

function getVisibleDrillMarks(
  chart: NormalizedReportChart,
  start: number,
  end: number,
): DrillDownRequest[] {
  if (chart.type === 'LINE' || chart.type === 'BAR' || chart.type === 'AREA') {
    const visiblePoints = chart.points.slice(start, end)
    const firstMetric = chart.series[0]?.metricId ?? 'metric'
    return visiblePoints.map((p) => ({
      pointKey: p.key,
      metricId: firstMetric,
      label: p.label,
    }))
  }
  if (chart.type === 'PIE' || chart.type === 'DONUT') {
    return chart.slices.slice(start, end).map((s) => ({
      pointKey: s.key,
      metricId: s.metricId,
      label: s.label,
    }))
  }
  if (chart.type === 'FUNNEL') {
    return chart.stages.slice(start, end).map((st) => ({
      pointKey: st.key,
      metricId: st.metricId,
      label: st.stageName,
    }))
  }
  if (chart.type === 'SCATTER') {
    return chart.points.slice(start, end).map((p) => ({
      pointKey: p.key,
      metricId: chart.xMetric.metricId,
      label: p.label,
    }))
  }
  if (chart.type === 'HEATMAP') {
    return chart.cells.slice(start, end).map((c) => ({
      pointKey: c.key,
      metricId: c.metricId,
      label: `${c.xLabel} - ${c.yLabel}`,
    }))
  }
  return []
}

// ── Custom Tooltip Renderers with Chart-Specific % / Conversion Rates (Contract C.16) ──

function PieDonutTooltipContent(props: unknown) {
  const { active, payload } = (props ?? {}) as {
    active?: boolean
    payload?: Array<{
      name?: string
      value?: number | string | null
      color?: string
      payload?: { label?: string; value?: number; percentage?: number }
    }>
  }
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  const data = item?.payload
  if (!data) return null

  return (
    <div
      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white shadow-md"
      data-testid="pie-tooltip"
    >
      <div className="font-semibold text-slate-200">{data.label}</div>
      <div className="mt-1 flex items-center justify-between gap-4 text-slate-300">
        <span>Value:</span>
        <span className="font-mono font-medium text-white">{data.value ?? item.value}</span>
      </div>
      {data.percentage !== undefined && (
        <div className="mt-0.5 flex items-center justify-between gap-4 text-slate-300">
          <span>Proportion:</span>
          <span className="font-mono font-medium text-emerald-400">
            {Number(data.percentage).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

function FunnelTooltipContent(props: unknown) {
  const { active, payload } = (props ?? {}) as {
    active?: boolean
    payload?: Array<{
      name?: string
      value?: number | string | null
      color?: string
      payload?: {
        stageName?: string
        value?: number
        previousConversionRate?: number | null
        overallConversionRate?: number | null
      }
    }>
  }
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  const data = item?.payload
  if (!data) return null

  return (
    <div
      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white shadow-md"
      data-testid="funnel-tooltip"
    >
      <div className="font-semibold text-slate-200">{data.stageName}</div>
      <div className="mt-1 flex items-center justify-between gap-4 text-slate-300">
        <span>Count:</span>
        <span className="font-mono font-medium text-white">{data.value ?? item.value}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-4 text-slate-300">
        <span>vs Previous Stage:</span>
        <span className="font-mono font-medium text-blue-400">
          {data.previousConversionRate !== null && data.previousConversionRate !== undefined
            ? `${data.previousConversionRate}%`
            : '—'}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-4 text-slate-300">
        <span>vs Overall (First Stage):</span>
        <span className="font-mono font-medium text-emerald-400">
          {data.overallConversionRate !== null && data.overallConversionRate !== undefined
            ? `${data.overallConversionRate}%`
            : '—'}
        </span>
      </div>
    </div>
  )
}

function HeatmapTooltipContent(props: unknown) {
  const { active, payload } = (props ?? {}) as {
    active?: boolean
    payload?: Array<{
      payload?: { cell?: { xLabel: string; yLabel: string; intensity: number } }
    }>
  }
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  const data = item?.payload?.cell
  if (!data) return null

  return (
    <div
      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white shadow-md"
      data-testid="heatmap-tooltip"
    >
      <div className="font-semibold text-slate-200">
        {data.xLabel} × {data.yLabel}
      </div>
      <div className="mt-1 flex items-center justify-between gap-4 text-slate-300">
        <span>Intensity / Value:</span>
        <span className="font-mono font-medium text-white">{data.intensity}</span>
      </div>
    </div>
  )
}

// ── Per-Chart Render Functions ──────────────────────────────────────────

function renderLineChart(
  chart: NormalizedLineChart,
  start: number,
  end: number,
  palette: string[],
  hiddenSeries: Set<string>,
  onDrillDown?: (req: DrillDownRequest) => void,
  customTooltip?: CustomTooltipProp,
) {
  const visibleData = chart.points.slice(start, end)

  return (
    <LineChart data={visibleData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
      <XAxis
        dataKey="label"
        stroke={CHART_THEME.axis}
        tick={{ fill: CHART_THEME.text, fontSize: 12 }}
      />
      <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 12 }} />
      {customTooltip ? <Tooltip content={customTooltip} /> : <Tooltip />}
      {chart.series.map((s, idx) => {
        if (hiddenSeries.has(s.metricId)) return null
        return (
          <Line
            key={s.metricId}
            type="monotone"
            dataKey={`values.${s.metricId}`}
            name={s.label}
            stroke={palette[idx % palette.length]}
            strokeWidth={2}
            activeDot={{
              r: 6,
              onClick: (_evt, payload: unknown) => {
                const item = (payload as { payload?: { key: string; label: string } }).payload
                if (item && onDrillDown) {
                  onDrillDown({ pointKey: item.key, metricId: s.metricId, label: item.label })
                }
              },
            }}
          />
        )
      })}
    </LineChart>
  )
}

function renderBarChart(
  chart: NormalizedBarChart,
  start: number,
  end: number,
  palette: string[],
  hiddenSeries: Set<string>,
  onDrillDown?: (req: DrillDownRequest) => void,
  customTooltip?: CustomTooltipProp,
) {
  const visibleData = chart.points.slice(start, end)
  const isHorizontal = chart.orientation === 'HORIZONTAL'

  return (
    <BarChart
      data={visibleData}
      layout={isHorizontal ? 'vertical' : 'horizontal'}
      margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
      {isHorizontal ? (
        <>
          <XAxis
            type="number"
            stroke={CHART_THEME.axis}
            tick={{ fill: CHART_THEME.text, fontSize: 12 }}
          />
          <YAxis
            dataKey="label"
            type="category"
            stroke={CHART_THEME.axis}
            tick={{ fill: CHART_THEME.text, fontSize: 12 }}
          />
        </>
      ) : (
        <>
          <XAxis
            dataKey="label"
            stroke={CHART_THEME.axis}
            tick={{ fill: CHART_THEME.text, fontSize: 12 }}
          />
          <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 12 }} />
        </>
      )}
      {customTooltip ? <Tooltip content={customTooltip} /> : <Tooltip />}
      {chart.series.map((s, idx) => {
        if (hiddenSeries.has(s.metricId)) return null
        return (
          <Bar
            key={s.metricId}
            dataKey={`values.${s.metricId}`}
            name={s.label}
            fill={palette[idx % palette.length]}
            onClick={(entry: unknown) => {
              const item = entry as { key?: string; label?: string }
              if (item?.key && onDrillDown) {
                onDrillDown({ pointKey: item.key, metricId: s.metricId, label: item.label ?? '' })
              }
            }}
          />
        )
      })}
    </BarChart>
  )
}

function renderPieChart(
  chart: NormalizedPieChart,
  start: number,
  end: number,
  palette: string[],
  hiddenSeries: Set<string>,
  onDrillDown?: (req: DrillDownRequest) => void,
  customTooltip?: CustomTooltipProp,
) {
  const visibleSlices = chart.slices.slice(start, end).filter((s) => !hiddenSeries.has(s.key))

  return (
    <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
      {customTooltip ? (
        <Tooltip content={customTooltip} />
      ) : (
        <Tooltip content={PieDonutTooltipContent} />
      )}
      <Pie
        data={visibleSlices}
        dataKey="value"
        nameKey="label"
        cx="50%"
        cy="50%"
        innerRadius={chart.isDonut ? '50%' : 0}
        outerRadius="80%"
        label={chart.showDataLabels}
        onClick={(entry: unknown) => {
          const item = (entry as { payload?: { key: string; label: string; metricId: string } })
            .payload
          if (item && onDrillDown) {
            onDrillDown({ pointKey: item.key, metricId: item.metricId, label: item.label })
          }
        }}
      >
        {visibleSlices.map((entry, index) => (
          <Cell key={`cell-${entry.key}`} fill={palette[index % palette.length]} />
        ))}
      </Pie>
    </PieChart>
  )
}

function renderFunnelChart(
  chart: NormalizedFunnelChart,
  start: number,
  end: number,
  palette: string[],
  hiddenSeries: Set<string>,
  onDrillDown?: (req: DrillDownRequest) => void,
  customTooltip?: CustomTooltipProp,
) {
  const visibleStages = chart.stages.slice(start, end).filter((st) => !hiddenSeries.has(st.key))

  return (
    <FunnelChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
      {customTooltip ? (
        <Tooltip content={customTooltip} />
      ) : (
        <Tooltip content={FunnelTooltipContent} />
      )}
      <Funnel
        dataKey="value"
        data={visibleStages}
        isAnimationActive={false}
        onClick={(entry: unknown) => {
          const item = (entry as { payload?: { key: string; stageName: string; metricId: string } })
            .payload
          if (item && onDrillDown) {
            onDrillDown({ pointKey: item.key, metricId: item.metricId, label: item.stageName })
          }
        }}
      >
        <LabelList position="right" fill="#1e293b" stroke="none" dataKey="stageName" />
        {visibleStages.map((entry, index) => (
          <Cell key={`funnel-${entry.key}`} fill={palette[index % palette.length]} />
        ))}
      </Funnel>
    </FunnelChart>
  )
}

function renderAreaChart(
  chart: NormalizedAreaChart,
  start: number,
  end: number,
  palette: string[],
  hiddenSeries: Set<string>,
  onDrillDown?: (req: DrillDownRequest) => void,
  customTooltip?: CustomTooltipProp,
) {
  const visibleData = chart.points.slice(start, end)

  return (
    <AreaChart data={visibleData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
      <XAxis
        dataKey="label"
        stroke={CHART_THEME.axis}
        tick={{ fill: CHART_THEME.text, fontSize: 12 }}
      />
      <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 12 }} />
      {customTooltip ? <Tooltip content={customTooltip} /> : <Tooltip />}
      {chart.series.map((s, idx) => {
        if (hiddenSeries.has(s.metricId)) return null
        const color = palette[idx % palette.length]
        return (
          <Area
            key={s.metricId}
            type="monotone"
            dataKey={`values.${s.metricId}`}
            name={`${s.label} (Cumulative)`}
            stroke={color}
            fill={color}
            fillOpacity={0.3}
            activeDot={{
              r: 6,
              onClick: (_evt, payload: unknown) => {
                const item = (payload as { payload?: { key: string; label: string } }).payload
                if (item && onDrillDown) {
                  onDrillDown({ pointKey: item.key, metricId: s.metricId, label: item.label })
                }
              },
            }}
          />
        )
      })}
    </AreaChart>
  )
}

function renderScatterChart(
  chart: NormalizedScatterChart,
  start: number,
  end: number,
  palette: string[],
  onDrillDown?: (req: DrillDownRequest) => void,
  customTooltip?: CustomTooltipProp,
) {
  const visibleData = chart.points.slice(start, end)

  return (
    <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
      <XAxis
        dataKey="x"
        name={chart.xMetric.label}
        stroke={CHART_THEME.axis}
        tick={{ fill: CHART_THEME.text, fontSize: 12 }}
      />
      <YAxis
        dataKey="y"
        name={chart.yMetric.label}
        stroke={CHART_THEME.axis}
        tick={{ fill: CHART_THEME.text, fontSize: 12 }}
      />
      {customTooltip ? (
        <Tooltip content={customTooltip} cursor={{ strokeDasharray: '3 3' }} />
      ) : (
        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
      )}
      <Scatter
        name="Correlation"
        data={visibleData}
        fill={palette[0] ?? '#2563eb'}
        onClick={(entry: unknown) => {
          const item = (entry as { payload?: { key: string; label: string } }).payload
          if (item && onDrillDown) {
            onDrillDown({ pointKey: item.key, metricId: chart.xMetric.metricId, label: item.label })
          }
        }}
      />
    </ScatterChart>
  )
}

function renderHeatmapChart(
  chart: NormalizedHeatmapChart,
  start: number,
  end: number,
  onDrillDown?: (req: DrillDownRequest) => void,
  customTooltip?: CustomTooltipProp,
) {
  const visibleCells = chart.cells.slice(start, end)

  // Map distinct x/y to numeric indices for Cartesian plotting
  const xIndexMap = new Map(chart.xLabels.map((l, i) => [l, i]))
  const yIndexMap = new Map(chart.yLabels.map((l, i) => [l, i]))

  const scatterData = visibleCells.map((c) => ({
    x: xIndexMap.get(c.xLabel) ?? 0,
    y: yIndexMap.get(c.yLabel) ?? 0,
    z: c.intensity,
    cell: c,
  }))

  const CustomHeatmapShape = (props: unknown) => {
    const { cx, cy, payload } = props as {
      cx?: number
      cy?: number
      payload?: {
        cell: {
          normalizedIntensity: number
          xLabel: string
          yLabel: string
          intensity: number
          key: string
          metricId: string
        }
      }
    }
    if (cx === undefined || cy === undefined || !payload) return null

    const color = getIntensityColor(payload.cell.normalizedIntensity)
    return (
      <g>
        <rect
          x={cx - 20}
          y={cy - 15}
          width={40}
          height={30}
          fill={color}
          stroke="#cbd5e1"
          strokeWidth={1}
          rx={3}
          style={{ cursor: onDrillDown ? 'pointer' : 'default' }}
          onClick={() => {
            if (onDrillDown) {
              onDrillDown({
                pointKey: payload.cell.key,
                metricId: payload.cell.metricId,
                label: `${payload.cell.xLabel} - ${payload.cell.yLabel}`,
              })
            }
          }}
        />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="#1e293b" fontWeight={500}>
          {payload.cell.intensity}
        </text>
      </g>
    )
  }

  return (
    <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
      <XAxis
        type="number"
        dataKey="x"
        domain={[0, Math.max(1, chart.xLabels.length - 1)]}
        ticks={chart.xLabels.map((_, i) => i)}
        tickFormatter={(val: number) => chart.xLabels[val] ?? ''}
        stroke={CHART_THEME.axis}
      />
      <YAxis
        type="number"
        dataKey="y"
        domain={[0, Math.max(1, chart.yLabels.length - 1)]}
        ticks={chart.yLabels.map((_, i) => i)}
        tickFormatter={(val: number) => chart.yLabels[val] ?? ''}
        stroke={CHART_THEME.axis}
      />
      {customTooltip ? (
        <Tooltip content={customTooltip} />
      ) : (
        <Tooltip content={HeatmapTooltipContent} />
      )}
      <Scatter data={scatterData} shape={<CustomHeatmapShape />} />
    </ScatterChart>
  )
}
