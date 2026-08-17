'use client'

/**
 * Story 6.3 & 6.4 — Visualization section of the custom report builder (AC 4, 16, 17).
 *
 * 9 chart choices (table + 8 charts), static previews, color tokens, legend position,
 * and inline chart-compatibility guidance.
 */
import React from 'react'
import type {
  CustomReportCatalog,
  CustomReportChartType,
  CustomReportColorToken,
  CustomReportDraft,
  CustomReportLegendPosition,
  CustomReportVisualization,
} from '@/lib/custom-report-builder'
import {
  CUSTOM_REPORT_CHART_TYPES,
  CUSTOM_REPORT_COLOR_TOKENS,
  CUSTOM_REPORT_COLOR_TOKEN_HEX,
  CUSTOM_REPORT_LEGEND_POSITIONS,
  CUSTOM_REPORT_ORIENTATIONS,
  LEGEND_POSITION_LABELS,
  chartCompatibilityErrors,
} from '@/lib/custom-report-builder'
import { ReportChartTypePreview } from './charting/ReportChartTypePreview'

type CustomReportVisualizationPanelProps = {
  draft: CustomReportDraft
  catalog: CustomReportCatalog | null
  onSetChartType: (chartType: CustomReportChartType) => void
  onUpdateVisualization: (patch: Partial<CustomReportVisualization>) => void
}

const fieldClass =
  'h-9 rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f]'

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex min-h-[34px] cursor-pointer items-center justify-between gap-2.5">
      <span className="text-[12.5px] text-[#4b4b55]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 flex-none rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f] ${
          checked ? 'bg-[#1b1b1f]' : 'bg-[#cbd5e1]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

export function CustomReportVisualizationPanel({
  draft,
  catalog,
  onSetChartType,
  onUpdateVisualization,
}: CustomReportVisualizationPanelProps): React.JSX.Element {
  const viz = draft.visualization
  const compatibilityErrors = chartCompatibilityErrors(viz.type, draft, catalog)
  const isBar = viz.type === 'BAR'
  const isTable = viz.type === 'TABLE'

  const selectedColors = viz.colors ?? []

  const toggleColorToken = (token: CustomReportColorToken) => {
    let next: CustomReportColorToken[]
    if (selectedColors.includes(token)) {
      if (selectedColors.length > 1) {
        next = selectedColors.filter((t) => t !== token)
      } else {
        next = selectedColors
      }
    } else {
      if (selectedColors.length < 10) {
        next = [...selectedColors, token]
      } else {
        next = selectedColors
      }
    }
    onUpdateVisualization({ colors: next })
  }

  return (
    <section
      aria-label="Visualization"
      className="rounded-[14px] border border-[#ececf0] bg-white p-[18px]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-[#1b1b1f] text-[12px] font-bold text-white">
          3
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Visualization</h2>
          <p className="mt-0.5 text-[12.5px] text-[#77777f]">
            Choose from 9 visualizations and configure presentation options.
          </p>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
        {CUSTOM_REPORT_CHART_TYPES.map((type) => {
          const selected = viz.type === type
          return (
            <ReportChartTypePreview
              key={type}
              type={type}
              selected={selected}
              onClick={() => onSetChartType(type)}
            />
          )
        })}
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-x-3.5 gap-y-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Chart title</span>
          <input
            type="text"
            aria-label="Chart title"
            value={viz.title ?? ''}
            onChange={(e) => onUpdateVisualization({ title: e.target.value || null })}
            placeholder="Revenue by stage"
            className={fieldClass}
          />
        </label>

        {!isTable && (
          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-medium text-[#8c8c96]">Legend position</span>
            <select
              aria-label="Legend position"
              value={viz.legendPosition ?? 'BOTTOM'}
              onChange={(e) =>
                onUpdateVisualization({
                  legendPosition: e.target.value as CustomReportLegendPosition,
                })
              }
              className={`${fieldClass} cursor-pointer`}
            >
              {CUSTOM_REPORT_LEGEND_POSITIONS.map((pos) => (
                <option key={pos} value={pos}>
                  {LEGEND_POSITION_LABELS[pos]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">X axis label</span>
          <input
            type="text"
            aria-label="X axis label"
            value={viz.xAxisLabel ?? ''}
            onChange={(e) => onUpdateVisualization({ xAxisLabel: e.target.value || null })}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Y axis label</span>
          <input
            type="text"
            aria-label="Y axis label"
            value={viz.yAxisLabel ?? ''}
            onChange={(e) => onUpdateVisualization({ yAxisLabel: e.target.value || null })}
            className={fieldClass}
          />
        </label>
        {isBar && (
          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-medium text-[#8c8c96]">Orientation</span>
            <select
              aria-label="Orientation"
              value={viz.orientation ?? 'VERTICAL'}
              onChange={(e) =>
                onUpdateVisualization({
                  orientation: e.target.value as CustomReportVisualization['orientation'],
                })
              }
              className={`${fieldClass} cursor-pointer`}
            >
              {CUSTOM_REPORT_ORIENTATIONS.map((o) => (
                <option key={o} value={o}>
                  {o === 'VERTICAL' ? 'Vertical' : 'Horizontal'}
                </option>
              ))}
            </select>
          </label>
        )}
        <Toggle
          label="Show legend"
          checked={viz.showLegend}
          onChange={(checked) => onUpdateVisualization({ showLegend: checked })}
        />
        <Toggle
          label="Show data labels"
          checked={viz.showDataLabels}
          onChange={(checked) => onUpdateVisualization({ showDataLabels: checked })}
        />
      </div>

      {/* Palette Color Token Selector */}
      {!isTable && (
        <div className="mt-3.5 border-t border-slate-100 pt-3">
          <span className="text-[11.5px] font-medium text-[#8c8c96] block mb-1.5">
            Chart color palette (1–10 tokens)
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chart color palette">
            {CUSTOM_REPORT_COLOR_TOKENS.map((token) => {
              const active = selectedColors.includes(token)
              const hex = CUSTOM_REPORT_COLOR_TOKEN_HEX[token]
              return (
                <button
                  key={token}
                  type="button"
                  onClick={() => toggleColorToken(token)}
                  aria-pressed={active}
                  aria-label={`Color ${token}`}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border transition-all ${
                    active
                      ? 'border-slate-800 bg-slate-900 text-white font-medium'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: hex }}
                  />
                  {token}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {compatibilityErrors.length > 0 ? (
        <div
          role="alert"
          className="mt-3 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-3.5 py-2.5"
        >
          <p className="text-[12px] font-semibold text-[#991b1b]">
            This chart type is not compatible with the current configuration:
          </p>
          <ul className="mt-1 list-disc pl-4 text-[12px] text-[#991b1b]">
            {compatibilityErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
