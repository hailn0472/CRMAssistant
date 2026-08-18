'use client'

/**
 * Story 6.3 & 6.4 — live preview panel (AC 9-10, Contract F.31).
 *
 * Renders validation / loading / refreshing / backend error / empty / data
 * states. Consolidates with ReportChart to support all 8 chart types,
 * zoom/pan, legend toggle, keyboard drill equivalents, and client-side PNG/SVG export.
 */
import React, { useMemo } from 'react'
import type { CustomReportResult } from '@/services/custom-report.service'
import type { CustomReportDraft } from '@/lib/custom-report-builder'
import type { DraftValidation } from '@/lib/custom-report-builder'
import { normalizeReportChart } from '@/lib/report-chart'
import { ReportChart, type DrillDownRequest } from './charting/ReportChart'

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
  onDrillDown?: (req: DrillDownRequest) => void
}

function formatCellValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
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
  onDrillDown,
}: CustomReportPreviewProps): React.JSX.Element {
  const viz = draft.visualization
  const title = viz.title || 'Report preview'
  const baseErrors = validation.errors.filter((e) =>
    /^(Choose a data source|Add at least one dimension|Add at least one metric)/.test(e),
  )
  const inValidationState = !validation.previewable || baseErrors.length > 0

  const normalizedChart = useMemo(() => {
    if (!result || result.rows.length === 0 || viz.type === 'TABLE') return null
    try {
      const { type: _discardedDraftType, ...presentationViz } = viz
      const resultWithCurrentViz: CustomReportResult = {
        ...result,
        config: {
          ...result.config,
          visualization: {
            ...result.config?.visualization,
            ...presentationViz,
            type: result.config?.visualization?.type ?? viz.type,
          },
        },
      }
      return normalizeReportChart(resultWithCurrentViz)
    } catch (err) {
      console.error('Failed to normalize report chart data:', err)
      return null
    }
  }, [result, viz])

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
          ) : normalizedChart ? (
            <div className="mt-3">
              <ReportChart chart={normalizedChart} onDrillDown={onDrillDown} />
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-slate-500">
              Chart representation unavailable.
            </div>
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
