'use client'

/**
 * Story 6.3 — live preview panel (AC 9-10, D.28).
 *
 * Renders validation / loading / refreshing / backend error / empty / data
 * states. Uses Recharts ^3.10.1 for line/bar/pie/funnel and a semantic HTML
 * table for TABLE. Every chart carries role="img" + aria-label, an explicit
 * legend when enabled, a tooltip, text labels (never color alone) and a
 * complete sr-only data table containing every datum (SalesReportChart
 * contract, AC 73-style). The debounced/cancelled query flow lives in
 * CustomReportBuilder; this component is a pure renderer of its states.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { CustomReportResult, CustomReportSeries } from '@/services/custom-report.service'
import type { CustomReportDraft } from '@/lib/custom-report-builder'
import type { DraftValidation } from '@/lib/custom-report-builder'

const CHART_COLORS = [
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

type CustomReportPreviewProps = {
  draft: CustomReportDraft
  catalog: unknown
  validation: DraftValidation
  result: CustomReportResult | null
  isLoading: boolean
  isRefreshing: boolean
  isError: boolean
  errorMessage: string | null
  onRetry: () => void
}

type TooltipPayloadItem = {
  value?: number | string
  name?: string
  payload?: { label?: string; value?: number | string }
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
}): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  return (
    <div className="rounded-lg border border-[#e6e6eb] bg-white px-3 py-2 shadow-md">
      <p className="text-[12px] font-semibold text-[#1b1b1f]">
        {item.payload?.label ?? item.name ?? ''}
      </p>
      <p className="text-[12px] text-[#4b4b55]">
        {String(item.payload?.value ?? item.value ?? '')}
      </p>
    </div>
  )
}

function formatCellValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function srOnlyTableForSeries(series: CustomReportSeries[], ariaLabel: string): React.JSX.Element {
  return (
    <table className="sr-only" aria-label={ariaLabel}>
      <thead>
        <tr>
          <th scope="col">Label</th>
          {series.map((s) => (
            <th key={s.metricId} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {series[0]?.points.map((point, index) => (
          <tr key={`${point.label}-${index}`}>
            <td>{point.label}</td>
            {series.map((s) => (
              <td key={s.metricId}>{s.points[index]?.value ?? '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SeriesChart({
  type,
  series,
  ariaLabel,
  showLegend,
}: {
  type: 'LINE' | 'BAR' | 'PIE' | 'FUNNEL'
  series: CustomReportSeries[]
  ariaLabel: string
  showLegend: boolean
}): React.JSX.Element {
  const primary = series[0]
  if (!primary)
    return <p className="py-10 text-center text-[13px] text-[#8c8c96]">No chart data.</p>
  const data = primary.points.map((p) => ({ label: p.label, value: p.value ?? 0 }))

  return (
    <div className="mt-3.5">
      <div role="img" aria-label={ariaLabel} className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'LINE' ? (
            <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e6eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#77777f' }} />
              <YAxis tick={{ fontSize: 11, fill: '#77777f' }} width={56} />
              <Tooltip content={<ChartTooltip />} />
              {showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
              <Line
                type="monotone"
                dataKey="value"
                name={primary.label}
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          ) : type === 'BAR' ? (
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e6eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#77777f' }} />
              <YAxis tick={{ fontSize: 11, fill: '#77777f' }} width={56} />
              <Tooltip content={<ChartTooltip />} />
              {showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
              <Bar dataKey="value" name={primary.label} fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : type === 'PIE' ? (
            <PieChart>
              <Tooltip content={<ChartTooltip />} />
              {showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(props) => {
                  const payload = props.payload as { label?: string } | undefined
                  return String(payload?.label ?? '')
                }}
              >
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <FunnelChart>
              <Tooltip content={<ChartTooltip />} />
              {showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
              <Funnel data={data} dataKey="value" nameKey="label">
                <LabelList position="right" fill="#1b1b1f" stroke="none" dataKey="label" />
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Funnel>
            </FunnelChart>
          )}
        </ResponsiveContainer>
      </div>

      {showLegend ? (
        <div aria-label="Legend" className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((s) => (
            <span
              key={s.metricId}
              className="inline-flex items-center gap-1.5 text-[12px] text-[#4b4b55]"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      {srOnlyTableForSeries(series, ariaLabel)}
    </div>
  )
}

export function CustomReportPreview({
  draft,
  validation,
  result,
  isLoading,
  isRefreshing,
  isError,
  errorMessage,
  onRetry,
}: CustomReportPreviewProps): React.JSX.Element {
  const viz = draft.visualization
  const title = viz.title || 'Report preview'
  const baseErrors = validation.errors.filter((e) =>
    /^(Choose a data source|Add at least one dimension|Add at least one metric)/.test(e),
  )
  const inValidationState = !validation.previewable || baseErrors.length > 0

  return (
    <section
      aria-label="Preview"
      className={`relative overflow-hidden rounded-[14px] border border-[#ececf0] bg-white p-[18px] ${
        isRefreshing && result ? 'preview-panel-refreshing' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-[#1b1b1f]">{title}</h3>
        {isRefreshing && result ? (
          <span className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-semibold text-[#059669]">
            Refreshing…
          </span>
        ) : null}
      </div>

      {inValidationState ? (
        <div className="py-8 text-center">
          <p className="text-[13.5px] font-medium text-[#1b1b1f]">Configuration incomplete</p>
          <ul className="mt-2 space-y-1 text-[12.5px] text-[#4b4b55]">
            {validation.errors
              .filter((e) =>
                /^(Choose a data source|Add at least one dimension|Add at least one metric)/.test(
                  e,
                ),
              )
              .map((error) => (
                <li key={error}>{error}</li>
              ))}
          </ul>
        </div>
      ) : isLoading && !result ? (
        <div className="py-10 text-center">
          <p className="text-[13px] text-[#8c8c96]">Loading preview…</p>
        </div>
      ) : isError && !result ? (
        <div className="py-8 text-center">
          <p role="alert" className="text-[13.5px] font-medium text-[#991b1b]">
            {errorMessage ?? 'Could not load the preview.'}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex min-h-[44px] items-center rounded-[9px] border border-[#e6e6eb] bg-white px-4 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            Retry
          </button>
        </div>
      ) : !result ? (
        <div className="py-10 text-center">
          <p className="text-[13px] text-[#8c8c96]">Configure the report to see a live preview.</p>
        </div>
      ) : result.rows.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-[13px] text-[#8c8c96]">No rows match the current configuration.</p>
        </div>
      ) : (
        <>
          {/* Warnings (e.g. division by zero, mixed currency) */}
          {result.warnings.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {result.warnings.map((warning) => (
                <p
                  key={warning.code}
                  role="alert"
                  className="rounded-[9px] border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[12px] text-[#92400e]"
                >
                  <b className="font-semibold">{warning.code.replace(/_/g, ' ')}:</b>{' '}
                  {warning.message}
                </p>
              ))}
            </div>
          ) : null}

          {viz.type === 'TABLE' ? (
            <div className="mt-3 overflow-x-auto rounded-[10px] border border-[#e6e6eb]">
              <table
                aria-label={`${title} data table`}
                className="w-full border-collapse text-[12.5px]"
              >
                <thead>
                  <tr>
                    {result.columns.map((column) => (
                      <th
                        key={column.fieldId}
                        scope="col"
                        className="whitespace-nowrap border-b border-[#e6e6eb] bg-[#fafafb] px-3 py-2 text-left font-semibold text-[#4b4b55]"
                      >
                        {column.label}
                        {column.aggregation
                          ? ` (${column.aggregation.toLowerCase().replace(/_/g, ' ')})`
                          : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.key} className="border-b border-[#f0f0f3] last:border-0">
                      {row.cells.map((cell) => (
                        <td
                          key={cell.fieldId}
                          className="whitespace-nowrap px-3 py-2 text-[#1b1b1f]"
                        >
                          {formatCellValue(
                            cell.stringValue ??
                              cell.numberValue ??
                              cell.booleanValue ??
                              cell.dateValue ??
                              null,
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <SeriesChart
              type={viz.type}
              series={result.series}
              ariaLabel={`${viz.type.toLowerCase()} chart for ${title} with ${result.series[0]?.points.length ?? 0} data points`}
              showLegend={viz.showLegend}
            />
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#f3f3f5] pt-2.5 text-[11.5px] text-[#8c8c96]">
            <span>
              Generated {new Date(result.generatedAt).toLocaleString()} · {result.totalRows} row
              {result.totalRows === 1 ? '' : 's'}
            </span>
            <span>
              Page {result.pagination.page} of {result.pagination.totalPages} ·{' '}
              {result.pagination.pageSize} per page
            </span>
          </div>
        </>
      )}
    </section>
  )
}
