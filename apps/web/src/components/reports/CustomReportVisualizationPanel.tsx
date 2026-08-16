'use client'

/**
 * Story 6.3 — Visualization section of the custom report builder (AC 9, D.24).
 *
 * Five chart choices (table/line/bar/pie/funnel), compatible display controls
 * and inline chart-compatibility errors (Contract A.10). Invalid chart/config
 * combinations show errors and never issue preview/save requests — the builder
 * gates requests via validateDraft, which includes these checks.
 */
import { BarChart3, PieChart, Rows3, TrendingUp, Filter as FunnelIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type {
  CustomReportCatalog,
  CustomReportChartType,
  CustomReportDraft,
  CustomReportVisualization,
} from '@/lib/custom-report-builder'
import { CUSTOM_REPORT_ORIENTATIONS, chartCompatibilityErrors } from '@/lib/custom-report-builder'

type CustomReportVisualizationPanelProps = {
  draft: CustomReportDraft
  catalog: CustomReportCatalog | null
  onSetChartType: (chartType: CustomReportChartType) => void
  onUpdateVisualization: (patch: Partial<CustomReportVisualization>) => void
}

const CHART_OPTIONS: Array<{
  type: CustomReportChartType
  label: string
  icon: LucideIcon
}> = [
  { type: 'TABLE', label: 'Table', icon: Rows3 },
  { type: 'LINE', label: 'Line', icon: TrendingUp },
  { type: 'BAR', label: 'Bar', icon: BarChart3 },
  { type: 'PIE', label: 'Pie', icon: PieChart },
  { type: 'FUNNEL', label: 'Funnel', icon: FunnelIcon },
]

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
            Choose a chart type and configure display options.
          </p>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-5 gap-2">
        {CHART_OPTIONS.map(({ type, label, icon: Icon }) => {
          const selected = viz.type === type
          return (
            <button
              key={type}
              type="button"
              aria-pressed={selected}
              onClick={() => onSetChartType(type)}
              className={`flex min-h-[56px] flex-col items-center gap-1 rounded-[10px] border px-1 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f] ${
                selected
                  ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                  : 'border-[#e6e6eb] bg-[#fafafb] text-[#4b4b55] hover:border-[#1b1b1f]'
              }`}
            >
              <Icon
                aria-hidden="true"
                className={`h-5 w-5 ${selected ? 'text-white' : 'text-[#8c8c96]'}`}
              />
              <span
                className={`text-[11.5px] font-medium ${selected ? 'text-white' : 'text-[#4b4b55]'}`}
              >
                {label}
              </span>
            </button>
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
        {isBar ? (
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
        ) : (
          <div />
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
