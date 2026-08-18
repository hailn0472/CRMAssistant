'use client'

/**
 * Story 6.5 — /reports/schedules Management Page Component (Contract F32-F35).
 * Lists all user schedules with report name/type, frequency summary, recipients count,
 * format, active/paused switch, localized next run time with <time dateTime>, last run status,
 * and row actions Edit/Pause/Resume/Delete.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
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
import { ScheduleReportDialog } from './ScheduleReportDialog'
import { formatFrequencySummary } from '@/lib/report-schedule-form'
import {
  deleteSchedule,
  getReportSchedules,
  pauseSchedule,
  reportScheduleKeys,
  resumeSchedule,
} from '@/services/report-schedule.service'
import type { ReportSchedule } from '@/services/report-schedule.service'
import { useMyPermissions } from '@/hooks/usePermission'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { EmptyState } from '@/components/shared/EmptyState'

export function ReportSchedulesPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'paused'>('all')

  const [editingSchedule, setEditingSchedule] = useState<ReportSchedule | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [deletingSchedule, setDeletingSchedule] = useState<ReportSchedule | null>(null)

  const { hasPermission, isLoading: isPermissionLoading } = useMyPermissions()
  const canReadReports = hasPermission('REPORT', 'READ')
  const canUpdateReport = hasPermission('REPORT', 'UPDATE')
  const canDeleteReport = hasPermission('REPORT', 'DELETE')

  const { data, isLoading, isError, error } = useQuery({
    queryKey: reportScheduleKeys.list({ page, pageSize, includeInactive: true }),
    queryFn: () => getReportSchedules({ page, pageSize }, true),
    enabled: canReadReports,
  })

  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportScheduleKeys.all })
      toast.success('Schedule paused')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to pause schedule')
    },
  })

  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportScheduleKeys.all })
      toast.success('Schedule resumed')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to resume schedule')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportScheduleKeys.all })
      toast.success('Schedule deleted')
      setDeletingSchedule(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete schedule')
    },
  })

  if (isPermissionLoading) {
    return (
      <div data-testid="schedules-loading-skeleton">
        <LoadingSkeleton />
      </div>
    )
  }

  if (!canReadReports) {
    return <PermissionLimitedState message="You do not have permission to view report schedules." />
  }

  if (isLoading) {
    return (
      <div data-testid="schedules-loading-skeleton">
        <LoadingSkeleton />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-xl border border-rose-200">
        <p className="font-semibold">Failed to fetch schedules</p>
        <p className="text-sm mt-1">{error?.message || 'An unexpected error occurred.'}</p>
      </div>
    )
  }

  const allItems = data?.items || []
  const filteredItems = allItems.filter((item) => {
    if (filterMode === 'active') return item.isActive
    if (filterMode === 'paused') return !item.isActive
    return true
  })

  const activeCount = allItems.filter((i) => i.isActive).length
  const pausedCount = allItems.filter((i) => !i.isActive).length

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-8 max-w-[1400px] w-full mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#e6e6eb]">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-[12.5px] text-[#77777f] mb-1.5"
          >
            <span>CRM</span>
            <span className="text-[#8c8c96]">/</span>
            <Link href="/reports/sales" className="hover:text-[#1b1b1f]">
              Reports
            </Link>
            <span className="text-[#8c8c96]">/</span>
            <span className="font-medium text-[#1b1b1f]">Schedules</span>
          </nav>
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#1b1b1f]">
              Scheduled Reports
            </h1>
            <span className="rounded-full bg-[#f4f4f6] border border-[#e6e6eb] px-2.5 py-0.5 text-[12px] font-semibold text-[#4b4b55]">
              {activeCount} active
            </span>
          </div>
          <p className="text-[13.5px] text-[#77777f] mt-1">
            Automate recurring report generation and delivery to your team via branded email.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex rounded-[9px] border border-[#e6e6eb] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`min-target px-3 py-1.5 rounded-[7px] text-[12.5px] font-medium transition-all ${
                filterMode === 'all'
                  ? 'bg-[#1b1b1f] text-white'
                  : 'text-[#4b4b55] hover:bg-[#f4f4f6]'
              }`}
            >
              All ({allItems.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('active')}
              className={`min-target px-3 py-1.5 rounded-[7px] text-[12.5px] font-medium transition-all ${
                filterMode === 'active'
                  ? 'bg-[#1b1b1f] text-white'
                  : 'text-[#4b4b55] hover:bg-[#f4f4f6]'
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('paused')}
              className={`min-target px-3 py-1.5 rounded-[7px] text-[12.5px] font-medium transition-all ${
                filterMode === 'paused'
                  ? 'bg-[#1b1b1f] text-white'
                  : 'text-[#4b4b55] hover:bg-[#f4f4f6]'
              }`}
            >
              Paused ({pausedCount})
            </button>
          </div>
        </div>
      </div>

      {/* Main Table / Empty State Card */}
      <div className="mt-6 rounded-[14px] border border-[#ececf0] bg-white shadow-xs overflow-hidden">
        {filteredItems.length === 0 ? (
          <EmptyState
            title="No scheduled report deliveries yet"
            description="Create automated schedules to email PDF, Excel, or CSV report snapshots directly to your team."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#ececf0] bg-[#fafafb] text-[11.5px] font-semibold uppercase tracking-wider text-[#8c8c96]">
                  <th scope="col" className="py-3.5 pl-5 pr-3">
                    Report Name & Type
                  </th>
                  <th scope="col" className="py-3.5 px-3">
                    Frequency & Cadence
                  </th>
                  <th scope="col" className="py-3.5 px-3">
                    Recipients
                  </th>
                  <th scope="col" className="py-3.5 px-3">
                    Format
                  </th>
                  <th scope="col" className="py-3.5 px-3">
                    Active
                  </th>
                  <th scope="col" className="py-3.5 px-3">
                    Next Run
                  </th>
                  <th scope="col" className="py-3.5 px-3">
                    Last Run Status
                  </th>
                  <th scope="col" className="py-3.5 pl-3 pr-5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f3] text-[13px]">
                {filteredItems.map((item) => {
                  const isSales = item.report.type !== 'CUSTOM'
                  const reportHref = isSales
                    ? `/reports/sales?reportId=${item.reportId}`
                    : `/reports/builder?reportId=${item.reportId}`

                  const nextRunDate = new Date(item.nextRunAt)
                  const lastExec = item.lastExecution

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-[#fafafb] transition-colors ${
                        !item.isActive ? 'opacity-70' : ''
                      }`}
                    >
                      {/* Report Name & Type */}
                      <td className="py-4 pl-5 pr-3">
                        <div>
                          <Link
                            href={reportHref}
                            className="font-semibold text-[#1b1b1f] hover:underline"
                          >
                            {item.report.name}
                          </Link>
                          <div className="mt-0.5 text-[11.5px] text-[#77777f]">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                              {item.report.type}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Frequency & Cadence */}
                      <td className="py-4 px-3">
                        <div className="font-medium text-[#1b1b1f]">
                          {formatFrequencySummary(item)}
                        </div>
                      </td>

                      {/* Recipients */}
                      <td className="py-4 px-3">
                        <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11.5px] font-medium text-slate-700">
                          {item.recipients.length} recipient
                          {item.recipients.length !== 1 ? 's' : ''}
                        </span>
                      </td>

                      {/* Format Badge */}
                      <td className="py-4 px-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${
                            item.format === 'PDF'
                              ? 'bg-rose-50 border border-rose-200 text-rose-700'
                              : item.format === 'EXCEL'
                                ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                                : 'bg-blue-50 border border-blue-200 text-blue-700'
                          }`}
                        >
                          {item.format}
                        </span>
                      </td>

                      {/* Active Switch Toggle */}
                      <td className="py-4 px-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.isActive}
                          disabled={!canUpdateReport}
                          onClick={() => {
                            if (item.isActive) {
                              pauseMutation.mutate(item.id)
                            } else {
                              resumeMutation.mutate(item.id)
                            }
                          }}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                            item.isActive ? 'bg-indigo-600' : 'bg-slate-300'
                          }`}
                        >
                          <span className="sr-only">Toggle active state</span>
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform ${
                              item.isActive ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </td>

                      {/* Next Run Time */}
                      <td className="py-4 px-3">
                        {item.isActive ? (
                          <div>
                            <time
                              role="time"
                              dateTime={item.nextRunAt}
                              className="font-medium text-[#1b1b1f]"
                            >
                              {nextRunDate.toLocaleString('en-US', {
                                timeZone: item.timezone,
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </time>
                            <div className="text-[11px] font-mono text-[#8c8c96]">
                              ({item.timezone})
                            </div>
                          </div>
                        ) : (
                          <span className="text-[12px] italic text-[#8c8c96]">— (Paused)</span>
                        )}
                      </td>

                      {/* Last Run Status */}
                      <td className="py-4 px-3">
                        {lastExec ? (
                          <div>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                                lastExec.status === 'SUCCESS'
                                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                                  : lastExec.status === 'FAILED'
                                    ? 'bg-red-50 border border-red-200 text-red-700'
                                    : 'bg-slate-100 border border-slate-200 text-slate-600'
                              }`}
                            >
                              {lastExec.status}
                            </span>
                            {lastExec.errorMessage && (
                              <div className="text-[11px] text-red-600 mt-0.5 truncate max-w-[160px]">
                                {lastExec.errorMessage}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[12px] text-[#8c8c96]">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 pl-3 pr-5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canUpdateReport && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSchedule(item)
                                setIsDialogOpen(true)
                              }}
                              className="min-target p-2 rounded-[7px] text-[#4b4b55] hover:text-[#1b1b1f] hover:bg-[#f4f4f6]"
                              title="Edit schedule"
                              aria-label={`Edit ${item.report.name} schedule`}
                            >
                              ✏️
                            </button>
                          )}
                          {canDeleteReport && (
                            <button
                              type="button"
                              onClick={() => setDeletingSchedule(item)}
                              className="min-target p-2 rounded-[7px] text-rose-600 hover:bg-rose-50"
                              title="Delete schedule"
                              aria-label={`Delete ${item.report.name} schedule`}
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls (Contract F32, AA-2) */}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-[#ececf0] bg-[#fafafb] text-[12.5px] text-[#77777f]">
            <div>
              Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} ({data.total}{' '}
              total)
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="h-8 px-3 text-[12.5px]"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(data.total / data.pageSize)}
                aria-label="Next page"
                className="h-8 px-3 text-[12.5px]"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Schedule Dialog */}
      {editingSchedule && (
        <ScheduleReportDialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open)
            if (!open) setEditingSchedule(null)
          }}
          reportId={editingSchedule.reportId}
          reportName={editingSchedule.report.name}
          reportType={editingSchedule.report.type}
          schedule={editingSchedule}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deletingSchedule && (
        <Dialog open={Boolean(deletingSchedule)} onOpenChange={() => setDeletingSchedule(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Report Schedule</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this schedule for &quot;
                {deletingSchedule.report.name}&quot;? Automated deliveries will cease.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeletingSchedule(null)}
                className="min-target"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => deleteMutation.mutate(deletingSchedule.id)}
                disabled={deleteMutation.isPending}
                className="min-target bg-rose-600 hover:bg-rose-700 text-white"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
