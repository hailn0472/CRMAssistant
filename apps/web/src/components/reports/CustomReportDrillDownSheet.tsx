/**
 * Story 6.4 (Contract E.29 / AC 15) — accessible Sheet for custom report drill-down.
 *
 * Uses TanStack Query with key ['customReports', 'drillDown', ...].
 * Supports loading, error, empty, and paginated records for all 4 sources.
 * Contacts, Deals, Tasks link to shipped detail pages; Activities link to related contacts.
 */
'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { ErrorState } from '@/components/shared/ErrorState'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  customReportDrillDown,
  type CustomReportConfig,
  type CustomReportDataSource,
} from '@/services/custom-report.service'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'

export interface CustomReportDrillDownSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportId?: string
  config?: CustomReportConfig
  pointKey: string | null
  metricId: string | null
  pointLabel?: string
}

const PAGE_SIZE = 20

export function CustomReportDrillDownSheet({
  open,
  onOpenChange,
  reportId,
  config,
  pointKey,
  metricId,
  pointLabel,
}: CustomReportDrillDownSheetProps) {
  const [page, setPage] = useState(1)

  const isEnabled = open && Boolean(pointKey && metricId && (reportId || config))

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['customReports', 'drillDown', reportId ?? 'preview', pointKey, metricId, page],
    queryFn: () =>
      customReportDrillDown({
        reportId,
        config,
        pointKey: pointKey!,
        metricId: metricId!,
        pagination: { page, pageSize: PAGE_SIZE },
      }),
    enabled: isEnabled,
    staleTime: 30_000,
  })

  const getRecordHref = (
    source: CustomReportDataSource,
    id: string,
    relatedContactId?: string | null,
  ) => {
    switch (source) {
      case 'CONTACTS':
        return `/contacts/${id}`
      case 'DEALS':
        return `/deals/${id}`
      case 'TASKS':
        return `/tasks/${id}`
      case 'ACTIVITIES':
        return relatedContactId ? `/contacts/${relatedContactId}` : null
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-6">
        <SheetHeader className="pb-4 border-b border-slate-100">
          <SheetTitle className="text-lg font-semibold text-slate-900">
            Underlying Records
          </SheetTitle>
          <SheetDescription className="text-xs text-slate-500">
            {pointLabel
              ? `Records for ${pointLabel}`
              : 'Underlying data records for selected point'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {isLoading && <TableSkeleton rows={4} columns={2} />}

          {isError && (
            <ErrorState
              message={
                error instanceof Error ? error.message : 'Failed to load underlying records.'
              }
              onRetry={() => refetch()}
            />
          )}

          {data && data.items.length === 0 && (
            <EmptyState
              title="No records found"
              description="No contributing records for this data point."
            />
          )}

          {data && data.items.length > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white overflow-hidden">
              {data.items.map((item) => {
                const href = getRecordHref(data.source, item.id, item.relatedRecordId)
                return (
                  <div
                    key={item.id}
                    className="p-3 hover:bg-slate-50 flex items-center justify-between gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {item.primaryLabel ?? item.id}
                      </div>
                      {item.secondaryLabel && (
                        <div className="text-xs text-slate-500 truncate">{item.secondaryLabel}</div>
                      )}
                    </div>
                    {href && (
                      <Link
                        href={href}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {data && data.totalPages > 1 && (
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <div>
              Page {data.page} of {data.totalPages} ({data.total} total)
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
