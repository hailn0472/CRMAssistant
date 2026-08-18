/**
 * Story 6.4 (Contract A.6 / AC 17) — static decorative previews for chart selector.
 *
 * Renders 9 labelled options (Table + 8 charts). Previews are 100% static SVGs,
 * decorative, and never trigger GraphQL requests.
 */
import React from 'react'
import type { CustomReportChartType } from '@/services/custom-report.service'
import { cn } from '@/lib/utils'

export interface ReportChartTypePreviewProps {
  type: CustomReportChartType
  selected?: boolean
  onClick?: () => void
  disabled?: boolean
}

export function ReportChartTypePreview({
  type,
  selected = false,
  onClick,
  disabled = false,
}: ReportChartTypePreviewProps) {
  const labelMap: Record<CustomReportChartType, string> = {
    TABLE: 'Table',
    LINE: 'Line Chart',
    BAR: 'Bar Chart',
    PIE: 'Pie Chart',
    DONUT: 'Donut Chart',
    AREA: 'Area Chart',
    FUNNEL: 'Funnel Chart',
    SCATTER: 'Scatter Plot',
    HEATMAP: 'Heatmap',
  }

  const label = labelMap[type]

  const renderIconSvg = () => {
    switch (type) {
      case 'TABLE':
        return (
          <svg
            className="h-6 w-6 text-slate-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 3h18v18H3z" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        )
      case 'LINE':
        return (
          <svg
            className="h-6 w-6 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 20h18" />
            <path d="M4 15l5-6 4 4 7-8" />
          </svg>
        )
      case 'BAR':
        return (
          <svg
            className="h-6 w-6 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 20V10" />
            <path d="M12 20V4" />
            <path d="M6 20v-6" />
          </svg>
        )
      case 'PIE':
        return (
          <svg
            className="h-6 w-6 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
            <path d="M22 12A10 10 0 0 0 12 2v10z" />
          </svg>
        )
      case 'DONUT':
        return (
          <svg
            className="h-6 w-6 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        )
      case 'AREA':
        return (
          <svg className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 20h18v-2l-6-6-4 4-5-6-3 4v6z" opacity="0.4" />
            <path d="M4 14l5-6 4 4 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        )
      case 'FUNNEL':
        return (
          <svg
            className="h-6 w-6 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M2 4h20l-7 9v7l-6-3v-4L2 4z" />
          </svg>
        )
      case 'SCATTER':
        return (
          <svg
            className="h-6 w-6 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="7" cy="15" r="1.5" fill="currentColor" />
            <circle cx="12" cy="8" r="1.5" fill="currentColor" />
            <circle cx="17" cy="12" r="1.5" fill="currentColor" />
            <circle cx="18" cy="6" r="1.5" fill="currentColor" />
            <path d="M3 20h18M3 4v16" />
          </svg>
        )
      case 'HEATMAP':
        return (
          <svg
            className="h-6 w-6 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="3" y="3" width="5" height="5" fill="#93c5fd" />
            <rect x="10" y="3" width="5" height="5" fill="#3b82f6" />
            <rect x="17" y="3" width="5" height="5" fill="#1d4ed8" />
            <rect x="3" y="10" width="5" height="5" fill="#60a5fa" />
            <rect x="10" y="10" width="5" height="5" fill="#1e40af" />
            <rect x="17" y="10" width="5" height="5" fill="#93c5fd" />
            <rect x="3" y="17" width="5" height="5" fill="#bfdbfe" />
            <rect x="10" y="17" width="5" height="5" fill="#60a5fa" />
            <rect x="17" y="17" width="5" height="5" fill="#3b82f6" />
          </svg>
        )
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-center transition-all focus:outline-none focus:ring-2 focus:ring-blue-500',
        selected
          ? 'border-blue-600 bg-blue-50/80 text-blue-900 shadow-sm'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      data-testid={`chart-preview-${type.toLowerCase()}`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100/70 p-1">
        {renderIconSvg()}
      </div>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </button>
  )
}
