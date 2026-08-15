'use client'

/**
 * Story 6.2 — accessible drill-down panel (AC 74, 79-80).
 *
 * Presentational: the workspace owns the reportData query (summary stays over
 * the full scope — AC 48) and passes the drill connection + pagination/scope
 * callbacks down. The Dialog traps and restores focus; the table uses
 * semantic headers and every row links to the deal/contact.
 */
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatMoney, formatDate } from '@/lib/sales-report-format'
import type { ReportDrillConnection, ReportDrillScope } from '@/services/sales-report.service'

type SalesReportDrillDownProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  metricLabel: string
  currency: string | null
  drill: ReportDrillConnection | null
  isLoading: boolean
  error: string | null
  scope: ReportDrillScope
  onScopeChange: (scope: ReportDrillScope) => void
  onPageChange: (page: number) => void
  /** Whether the report has a comparison period (comparisonMode !== NONE). */
  hasComparison: boolean
}

export function SalesReportDrillDown({
  open,
  onOpenChange,
  metricLabel,
  currency,
  drill,
  isLoading,
  error,
  scope,
  onScopeChange,
  onPageChange,
  hasComparison,
}: SalesReportDrillDownProps): React.JSX.Element {
  const totalPages = drill ? Math.max(Math.ceil(drill.total / Math.max(drill.pageSize, 1)), 1) : 1
  const currentPage = drill?.page ?? 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Underlying deals — {metricLabel}</DialogTitle>
        </DialogHeader>

        {/* Current/Comparison scope toggle (AC 53): re-runs the same closed
            predicate against the comparison period. COMPARISON is offered only
            when a comparison period is actually configured (AC 53/74) —
            otherwise selecting it would 400 against the backend. */}
        <div
          role="group"
          aria-label="Drill-down scope"
          className="flex flex-wrap items-center gap-2"
        >
          {(hasComparison
            ? (['CURRENT', 'COMPARISON'] as ReportDrillScope[])
            : (['CURRENT'] as ReportDrillScope[])
          ).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={(!hasComparison ? 'CURRENT' : scope) === option}
              onClick={() => onScopeChange(option)}
              className={`min-h-[44px] rounded-[9px] border px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f] ${
                scope === option
                  ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                  : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:bg-[#f4f4f6]'
              }`}
            >
              {option === 'CURRENT' ? 'Current period' : 'Comparison period'}
            </button>
          ))}
          <p className="text-[12px] text-[#8c8c96]" aria-live="polite">
            {drill ? `${drill.total} deal${drill.total === 1 ? '' : 's'} found` : ''}
          </p>
        </div>

        {error ? (
          <ErrorState
            title="Could not load drill-down"
            message={error}
            onRetry={() => onPageChange(currentPage)}
          />
        ) : isLoading && !drill ? (
          <TableSkeleton rows={5} columns={4} />
        ) : !drill || drill.items.length === 0 ? (
          <EmptyState
            title="No underlying deals"
            description="No deals match this metric for the selected scope."
          />
        ) : (
          <>
            <ResponsiveTableWrapper>
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">
                  Underlying deals for {metricLabel} in the{' '}
                  {scope === 'CURRENT' ? 'current' : 'comparison'} period
                </caption>
                <thead>
                  <tr className="border-b border-[#ececf0] text-[11.5px] uppercase tracking-wide text-[#8c8c96]">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Deal
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Stage
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Contact
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Owner
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Value
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Closed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {drill.items.map((row) => (
                    <tr key={row.id} className="border-b border-[#f0f0f3] last:border-0">
                      <td className="px-3 py-2.5">
                        <a
                          href={row.dealHref}
                          className="inline-flex items-center gap-1 font-medium text-[#1b1b1f] underline-offset-2 hover:underline"
                        >
                          {row.title}
                          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 text-[#8c8c96]" />
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-[#4b4b55]">{row.stageName ?? '—'}</td>
                      <td className="px-3 py-2.5 text-[#4b4b55]">
                        {row.contactHref ? (
                          <a
                            href={row.contactHref}
                            className="text-[#1b1b1f] underline-offset-2 hover:underline"
                          >
                            {row.contactName ?? '—'}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#4b4b55]">{row.ownerName ?? '—'}</td>
                      <td className="px-3 py-2.5 font-medium text-[#1b1b1f]">
                        {formatMoney(row.value, row.currency || currency)}
                      </td>
                      <td className="px-3 py-2.5 text-[#4b4b55]">
                        {formatDate(row.actualCloseDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTableWrapper>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] text-[#8c8c96]" aria-live="polite">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => onPageChange(currentPage - 1)}
                  aria-label="Previous page"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => onPageChange(currentPage + 1)}
                  aria-label="Next page"
                >
                  Next
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
