'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Table as TableIcon,
  Trash2,
  XCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { useMyPermissions } from '@/hooks/usePermission'
import { downloadFileFromUrl } from '@/lib/browser-download'
import {
  deleteReportExport,
  getReportExport,
  getReportExportDownloadUrl,
  getReportExports,
  reportExportKeys,
  type ReportDeliveryFormat,
  type ReportExport,
  type ReportExportStatus,
} from '@/services/report-export.service'
import { formatRelativeTime } from '@/lib/notification-format'

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}

function StatusBadge({
  status,
  errorMessage,
}: {
  status: ReportExportStatus
  errorMessage?: string | null
}) {
  switch (status) {
    case 'READY':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Ready
        </span>
      )
    case 'PROCESSING':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700">
          <Loader2 className="h-3 w-3 animate-spin text-indigo-600" />
          Processing
        </span>
      )
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
          <Clock className="h-3 w-3 text-amber-600" />
          Queued
        </span>
      )
    case 'FAILED':
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700"
          title={errorMessage || 'Export failed'}
        >
          <XCircle className="h-3 w-3 text-red-600" />
          Failed
        </span>
      )
  }
}

function FormatIcon({ format }: { format: ReportDeliveryFormat }) {
  switch (format) {
    case 'PDF':
      return <FileText aria-hidden="true" className="h-4 w-4 text-red-600" />
    case 'EXCEL':
      return <FileSpreadsheet aria-hidden="true" className="h-4 w-4 text-emerald-600" />
    case 'CSV':
      return <TableIcon aria-hidden="true" className="h-4 w-4 text-blue-600" />
  }
}

export function ReportExportsPage(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const downloadParam = searchParams.get('download')
  const exportIdParam = searchParams.get('exportId')

  const [page, setPage] = useState(1)
  const pageSize = 20
  const [statusFilter, setStatusFilter] = useState<ReportExportStatus | 'ALL'>('ALL')
  const [formatFilter, setFormatFilter] = useState<ReportDeliveryFormat | 'ALL'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingExport, setDeletingExport] = useState<ReportExport | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const downloadProcessedRef = useRef<string | null>(null)

  const { hasPermission, isLoading: isPermissionLoading } = useMyPermissions()
  const canReadReports = hasPermission('REPORT', 'READ')

  const exportsQuery = useQuery({
    queryKey: reportExportKeys.list({ page, pageSize }),
    queryFn: () => getReportExports({ page, pageSize }),
    enabled: canReadReports,
    refetchInterval: (query) => {
      // Auto-poll if any row is PENDING or PROCESSING
      const hasInProgress = query.state.data?.items.some(
        (item) => item.status === 'PENDING' || item.status === 'PROCESSING',
      )
      return hasInProgress ? 3000 : false
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReportExport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportExportKeys.all })
      toast.success('Export history deleted')
      setDeletingExport(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete export')
    },
  })

  const handleDownload = async (item: ReportExport) => {
    if (item.status !== 'READY') return
    try {
      setDownloadingId(item.id)
      let download: { url: string; expiresAt: string } | null = null
      try {
        download = await getReportExportDownloadUrl(item.id)
      } catch (err: unknown) {
        toast.error(
          (err as Error).message || 'Failed to obtain download URL. Export might have expired.',
        )
        return
      }

      if (download?.url) {
        const filename =
          item.filename || `${item.report?.name || 'report'}.${item.format.toLowerCase()}`
        try {
          await downloadFileFromUrl({
            url: download.url,
            filename,
            fallbackFilename: `${item.report?.name || 'report'}.${item.format.toLowerCase()}`,
          })
          toast.success(`Downloading ${item.filename || 'export'}...`)
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Failed to download export file.')
        }
      }
    } finally {
      setDownloadingId(null)
    }
  }

  // Story 6.6 (Contract E.35 / M3): Handle ?download=<id> auto-download exactly once then clear URL
  // If not present in current page, fetch via getReportExport(id).
  useEffect(() => {
    if (!downloadParam || exportsQuery.isLoading) return

    if (downloadProcessedRef.current === downloadParam) return

    downloadProcessedRef.current = downloadParam

    // Clear download query param from URL without page refresh
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.delete('download')
    const newQuery = newParams.toString()
    router.replace(newQuery ? `/reports/exports?${newQuery}` : '/reports/exports', {
      scroll: false,
    })

    const targetItem = exportsQuery.data?.items.find((item) => item.id === downloadParam)

    const processItem = (item: ReportExport) => {
      if (item.status === 'READY') {
        handleDownload(item)
      } else if (item.status === 'FAILED') {
        toast.error(
          `Export failed: ${item.errorMessage || 'Unknown error'}. Narrow your date range or filters.`,
        )
      } else {
        toast('Export is still processing. It will be ready shortly.')
      }
    }

    if (targetItem) {
      processItem(targetItem)
    } else {
      // Off-page item: fetch owner-visible detail directly
      getReportExport(downloadParam)
        .then((offPageItem) => {
          if (offPageItem) {
            processItem(offPageItem)
          } else {
            toast.error('Export not found or access denied.')
          }
        })
        .catch((err: unknown) => {
          toast.error((err as Error).message || 'Export not found or access denied.')
        })
    }
  }, [downloadParam, exportsQuery.data, exportsQuery.isLoading, router, searchParams])

  const filteredItems = useMemo(() => {
    const items = exportsQuery.data?.items ?? []
    return items.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false
      if (formatFilter !== 'ALL' && item.format !== formatFilter) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchName = item.filename?.toLowerCase().includes(query)
        const matchReport = item.report?.name.toLowerCase().includes(query)
        const matchFilter = item.filterSummary.toLowerCase().includes(query)
        if (!matchName && !matchReport && !matchFilter) return false
      }
      return true
    })
  }, [exportsQuery.data?.items, statusFilter, formatFilter, searchQuery])

  if (isPermissionLoading) {
    return (
      <div data-testid="exports-loading-skeleton">
        <LoadingSkeleton />
      </div>
    )
  }

  if (!canReadReports) {
    return (
      <PermissionLimitedState
        requiredPermission="REPORT:READ"
        message="You do not have permission to view export history."
      />
    )
  }

  const counts = {
    all: exportsQuery.data?.total ?? 0,
    ready: exportsQuery.data?.items.filter((i) => i.status === 'READY').length ?? 0,
    processing:
      exportsQuery.data?.items.filter((i) => i.status === 'PROCESSING' || i.status === 'PENDING')
        .length ?? 0,
    failed: exportsQuery.data?.items.filter((i) => i.status === 'FAILED').length ?? 0,
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      {/* Header & Title */}
      <div className="flex flex-col justify-between gap-4 pb-4 border-b border-[#ececf0] sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#1b1b1f]">
            Export History & Downloads
          </h1>
          <p className="mt-1 text-xs text-[#77777f]">
            Your generated report files. Secure private Supabase Storage downloads with fresh
            24-hour signed URLs.
          </p>
        </div>
      </div>

      {/* Safety Bounds & Large Report Policy Notice */}
      <div
        data-testid="size-warning-banner"
        className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"
      >
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 flex-none text-amber-600" />
        <div className="flex-1">
          <div className="font-semibold text-amber-950">Safety Bounds & Large Report Policy</div>
          <p className="mt-0.5 text-amber-800">
            User exports are bounded at <strong>50 MB, 50,000 rows, and 50 columns</strong> without
            silent truncation. Reports over 100 rows run asynchronously via durable background
            worker. If an export exceeds 50MB, a safe warning is shown and you can narrow the date
            filter.
          </p>
        </div>
      </div>

      {/* Controls Bar: Status Filter Tabs, Format Dropdown, Search */}
      <div className="flex flex-col items-center justify-between gap-3 rounded-[14px] border border-[#ececf0] bg-white p-3.5 shadow-sm md:flex-row">
        {/* Status Tabs */}
        <div className="flex w-full items-center gap-1 overflow-x-auto rounded-lg bg-[#f4f4f6] p-1 text-xs md:w-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`rounded-md px-3 py-1.5 font-medium transition-all ${
              statusFilter === 'ALL'
                ? 'bg-white text-[#1b1b1f] shadow-sm'
                : 'text-[#77777f] hover:text-[#1b1b1f]'
            }`}
          >
            All Statuses ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('READY')}
            className={`rounded-md px-3 py-1.5 font-medium transition-all ${
              statusFilter === 'READY'
                ? 'bg-white text-[#1b1b1f] shadow-sm'
                : 'text-[#77777f] hover:text-[#1b1b1f]'
            }`}
          >
            Ready ({counts.ready})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PROCESSING')}
            className={`rounded-md px-3 py-1.5 font-medium transition-all ${
              statusFilter === 'PROCESSING'
                ? 'bg-white text-[#1b1b1f] shadow-sm'
                : 'text-[#77777f] hover:text-[#1b1b1f]'
            }`}
          >
            Processing ({counts.processing})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('FAILED')}
            className={`rounded-md px-3 py-1.5 font-medium transition-all ${
              statusFilter === 'FAILED'
                ? 'bg-white text-[#1b1b1f] shadow-sm'
                : 'text-[#77777f] hover:text-[#1b1b1f]'
            }`}
          >
            Failed ({counts.failed})
          </button>
        </div>

        {/* Format Filter & Search */}
        <div className="flex w-full items-center gap-2 md:w-auto">
          <select
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value as ReportDeliveryFormat | 'ALL')}
            aria-label="Filter by format"
            className="h-8 rounded-[8px] border border-[#e6e6eb] bg-white px-2.5 text-xs text-[#1b1b1f] outline-none"
          >
            <option value="ALL">All Formats (PDF, XLS, CSV)</option>
            <option value="PDF">PDF only</option>
            <option value="EXCEL">Excel (.xlsx) only</option>
            <option value="CSV">CSV only</option>
          </select>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search filename or report..."
            aria-label="Search exports"
            className="h-8 w-full rounded-[8px] border border-[#e6e6eb] bg-white px-2.5 text-xs text-[#1b1b1f] outline-none focus:border-[#1b1b1f] md:w-48"
          />
        </div>
      </div>

      {/* Main Content Area: Loading / Error / Empty / Table / Cards */}
      {exportsQuery.isLoading ? (
        <div data-testid="exports-table-skeleton">
          <LoadingSkeleton />
        </div>
      ) : exportsQuery.isError ? (
        <ErrorState
          title="Could not load export history"
          message={(exportsQuery.error as Error).message || 'Failed to retrieve export records.'}
          onRetry={() => exportsQuery.refetch()}
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<Download className="h-6 w-6" />}
          title="No export records found"
          description={
            searchQuery || statusFilter !== 'ALL' || formatFilter !== 'ALL'
              ? 'No export records match the selected filters.'
              : 'You have not exported any reports yet. Use the Export button on any saved report.'
          }
        />
      ) : (
        <>
          {/* Desktop & Tablet Table */}
          <div className="hidden rounded-[14px] border border-[#ececf0] bg-white shadow-sm sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#ececf0] bg-[#fafafb] font-semibold text-[#77777f]">
                  <tr>
                    <th className="py-3 px-4">Filename & Report</th>
                    <th className="py-3 px-3">Format</th>
                    <th className="py-3 px-3">Filter Scope & Date Range</th>
                    <th className="py-3 px-3">File Size</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Generated</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ececf0] text-[#1b1b1f]">
                  {filteredItems.map((item) => {
                    const isTarget = exportIdParam === item.id
                    const isDownloading = downloadingId === item.id

                    return (
                      <tr
                        key={item.id}
                        data-testid={`export-row-${item.id}`}
                        className={`transition-colors hover:bg-[#fafafb] ${
                          isTarget ? 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-400' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <FormatIcon format={item.format} />
                            <div className="min-w-0">
                              <p className="font-medium text-[#1b1b1f] truncate max-w-[220px]">
                                {item.filename ||
                                  item.report?.name ||
                                  (item.sourceType === 'ACTIVITY_REPORT'
                                    ? 'Activity Report'
                                    : 'Report Export')}
                              </p>
                              <p className="text-[11px] text-[#8c8c96] truncate">
                                {item.report?.name ||
                                  (item.sourceType === 'ACTIVITY_REPORT'
                                    ? 'Activity report'
                                    : 'Custom / Ad-hoc')}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-mono text-[11px] uppercase text-[#4b4b55]">
                            {item.format === 'EXCEL' ? 'XLSX' : item.format}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="max-w-[200px] text-[11px] text-[#4b4b55]">
                            <p className="truncate font-medium">
                              {item.filterSummary || 'Default'}
                            </p>
                            {item.dateRangeStart && item.dateRangeEnd ? (
                              <p className="text-[10px] text-[#8c8c96]">
                                {item.dateRangeStart} to {item.dateRangeEnd}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-[#4b4b55]">
                          {formatFileSize(item.fileSizeBytes)}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={item.status} errorMessage={item.errorMessage} />
                          {item.status === 'FAILED' && item.errorMessage ? (
                            <p
                              className="mt-1 text-[10px] text-red-600 max-w-[180px] truncate"
                              title={item.errorMessage}
                            >
                              {item.errorMessage}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-3 px-3 text-[11px] text-[#77777f]">
                          <time dateTime={item.createdAt}>
                            {formatRelativeTime(item.createdAt)}
                          </time>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.status === 'READY' ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isDownloading}
                                onClick={() => handleDownload(item)}
                                aria-label={`Download ${item.filename || 'report'}`}
                                className="min-h-[44px] min-w-[44px] gap-1 border-indigo-600 text-indigo-700 hover:bg-indigo-50"
                              >
                                {isDownloading ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                                <span>Download</span>
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeletingExport(item)}
                              aria-label={`Delete export ${item.filename || item.id}`}
                              className="min-h-[44px] min-w-[44px] text-[#77777f] hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Cards (at 320px viewport without overflow, min touch target 44px) */}
          <div className="space-y-3 sm:hidden">
            {filteredItems.map((item) => {
              const isTarget = exportIdParam === item.id
              const isDownloading = downloadingId === item.id

              return (
                <div
                  key={item.id}
                  data-testid={`export-card-${item.id}`}
                  className={`rounded-xl border border-[#ececf0] bg-white p-3.5 shadow-sm space-y-2.5 ${
                    isTarget ? 'ring-2 ring-indigo-500 bg-indigo-50/50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FormatIcon format={item.format} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#1b1b1f] truncate">
                          {item.filename || item.report?.name || 'Report Export'}
                        </p>
                        <p className="text-[10px] text-[#8c8c96] truncate">
                          {item.report?.name || 'Custom'}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={item.status} errorMessage={item.errorMessage} />
                  </div>

                  <div className="text-[11px] text-[#4b4b55] space-y-0.5">
                    <p className="truncate">Scope: {item.filterSummary || 'Default'}</p>
                    <div className="flex items-center justify-between text-[10px] text-[#8c8c96]">
                      <span>Size: {formatFileSize(item.fileSizeBytes)}</span>
                      <span>{formatRelativeTime(item.createdAt)}</span>
                    </div>
                    {item.status === 'FAILED' && item.errorMessage ? (
                      <p className="text-[10px] text-red-600 mt-1">{item.errorMessage}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ececf0]">
                    {item.status === 'READY' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isDownloading}
                        onClick={() => handleDownload(item)}
                        aria-label={`Download ${item.filename || 'report'}`}
                        className="min-h-[44px] min-w-[44px] flex-1 border-indigo-600 text-indigo-700 hover:bg-indigo-50"
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        <span>Download</span>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingExport(item)}
                      aria-label={`Delete export ${item.filename || item.id}`}
                      className="min-h-[44px] min-w-[44px] text-[#77777f] hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination Controls */}
          {exportsQuery.data && exportsQuery.data.total > pageSize ? (
            <div className="flex items-center justify-between px-2 text-xs text-[#77777f]">
              <div>
                Showing {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, exportsQuery.data.total)} of {exportsQuery.data.total}{' '}
                export records
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="min-h-[44px]"
                >
                  Previous
                </Button>
                <span className="px-2 font-medium text-[#1b1b1f]">{page}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * pageSize >= exportsQuery.data.total}
                  onClick={() => setPage((p) => p + 1)}
                  className="min-h-[44px]"
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingExport)}
        onOpenChange={(open) => {
          if (!open) setDeletingExport(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Export History</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{' '}
              <strong className="text-[#1b1b1f]">
                {deletingExport?.filename || 'this report export'}
              </strong>
              ? The stored file will be removed and cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingExport(null)}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deletingExport && deleteMutation.mutate(deletingExport.id)}
              className="min-h-[44px]"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Export'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
