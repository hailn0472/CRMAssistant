'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, CheckCircle2, RefreshCw, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { getTaskCalendarSync, syncTaskToCalendar } from '@/services/calendar.service'
import type { CalendarProvider } from '@/services/calendar.service'

// Story 4.3 task-detail badge (AC 45-46). States: Synced (with provider name
// and last-synced time), Pending, Failed (with lastError and a Retry button),
// Not connected (a quiet link to /settings/calendars — not an error). A
// conflict shows an additional warning badge carrying conflictSummary as
// visible text, not only a tooltip.

const PROVIDER_LABELS: Record<CalendarProvider, string> = {
  GOOGLE: 'Google Calendar',
  OUTLOOK: 'Outlook Calendar',
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

export function TaskCalendarSyncBadge({ taskId }: { taskId: string }): React.JSX.Element | null {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['taskCalendarSync', taskId],
    queryFn: () => getTaskCalendarSync(taskId),
    staleTime: 30_000,
  })

  const retryMutation = useMutation({
    mutationFn: () => syncTaskToCalendar(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCalendarSync', taskId] })
    },
  })

  if (isLoading || data === undefined) return null

  // No link row — the task was never pushed (no due date or no connected
  // calendar). A quiet link, not an error (AC 45).
  if (data === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
        <CalendarClock className="h-3.5 w-3.5" />
        Not synced to calendar
        <Link
          href="/settings/calendars"
          className="text-indigo-600 underline-offset-2 hover:underline"
        >
          Connect
        </Link>
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {data.syncStatus === 'SYNCED' && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Synced
          {data.provider ? ` · ${PROVIDER_LABELS[data.provider]}` : ''}
          {data.lastSyncedAt ? ` · ${formatTime(data.lastSyncedAt)}` : ''}
        </span>
      )}

      {data.syncStatus === 'PENDING' && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
          <CalendarClock className="h-3.5 w-3.5" />
          Pending
        </span>
      )}

      {data.syncStatus === 'FAILED' && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
          <XCircle className="h-3.5 w-3.5" />
          Sync failed
        </span>
      )}

      {data.conflictSummary && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          {data.conflictSummary}
        </span>
      )}

      {data.syncStatus === 'FAILED' && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => retryMutation.mutate()}
          disabled={retryMutation.isPending}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      )}

      {data.lastError ? (
        <span className="text-xs text-red-600" title={data.lastError}>
          {data.lastError}
        </span>
      ) : null}
    </div>
  )
}
