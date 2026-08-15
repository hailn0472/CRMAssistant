'use client'

/**
 * Story 6.2 — minimal accessible report chart (AC 72-73, 80).
 *
 * Recharts is mocked wholesale in specs; the semantic contract asserted there:
 * custom tooltip, explicit legend, role="img" label, and a hand-written
 * sr-only table containing EVERY datum (the v3 accessibilityLayer never
 * replaces the table alternative). Keyboard users get an explicit
 * "View underlying deals" button per bucket (AC 72) — never a chart-only path.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { cn } from '@/lib/utils'

export type ChartDatum = {
  key: string
  label: string
  value: number
  count: number
  formatted: string
}

type SalesReportChartProps = {
  title: string
  ariaLabel: string
  series: ChartDatum[]
  onDrill: (bucketKey: string) => void
  emptyMessage?: string
}

type TooltipPayloadItem = {
  value?: number
  payload?: { label?: string; count?: number; formatted?: string }
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
  const datum = item.payload
  if (!datum) return null
  return (
    <div className="rounded-lg border border-[#e6e6eb] bg-white px-3 py-2 shadow-md">
      <p className="text-[12px] font-semibold text-[#1b1b1f]">{datum.label}</p>
      <p className="text-[12px] text-[#4b4b55]">
        {datum.formatted ?? String(item.value ?? '')}
        {typeof datum.count === 'number' ? ` · ${datum.count} deals` : ''}
      </p>
    </div>
  )
}

export function SalesReportChart({
  title,
  ariaLabel,
  series,
  onDrill,
  emptyMessage = 'No data for the selected period.',
}: SalesReportChartProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="sales-report-chart-title"
      className="rounded-[14px] border border-[#ececf0] bg-white p-[18px]"
    >
      <h3 id="sales-report-chart-title" className="text-[15px] font-semibold text-[#1b1b1f]">
        {title}
      </h3>
      {series.length === 0 ? (
        <p className="mt-6 text-center text-[13px] text-[#8c8c96]">{emptyMessage}</p>
      ) : (
        <>
          <div role="img" aria-label={ariaLabel} className="mt-4 h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6e6eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#77777f' }} />
                <YAxis tick={{ fontSize: 11, fill: '#77777f' }} width={64} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="value"
                  name={title}
                  fill="#2563eb"
                  radius={[4, 4, 0, 0]}
                  onClick={(datum: unknown) => {
                    const d = datum as { key?: string }
                    if (d?.key) onDrill(d.key)
                  }}
                  cursor="pointer"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Keyboard path: an explicit "View underlying deals" button per datum (AC 72). */}
          <ul
            className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto"
            aria-label={`${title} drill buttons`}
          >
            {series.map((datum) => (
              <li key={datum.key}>
                <button
                  type="button"
                  onClick={() => onDrill(datum.key)}
                  className="min-h-[44px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[12px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f0f0f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
                >
                  View underlying deals: {datum.label}
                </button>
              </li>
            ))}
          </ul>

          {/* Complete sr-only alternative table with every datum (AC 73). */}
          <table className="sr-only" aria-label={ariaLabel}>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Value</th>
                <th scope="col">Deals</th>
              </tr>
            </thead>
            <tbody>
              {series.map((datum) => (
                <tr key={datum.key} className={cn('sr-only')}>
                  <td>{datum.label}</td>
                  <td>{datum.formatted}</td>
                  <td>{datum.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
