'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Play, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  getActiveTimeEntry,
  getTimeEntries,
  startTimer,
  stopTimer,
} from '@/services/time-entry.service'
import { usePermission } from '@/hooks/usePermission'
import { elapsedSeconds, formatDurationShort, formatElapsed } from '@/lib/time-format'
import { formatDateInput, todayUtc } from '@/lib/win-loss-format'

// Story 4.5 task-detail timer widget (AC 33-37). Self-contained: owns its
// queries and mutations, returns null while loading — the exact shape of
// TaskCalendarSyncBadge. It must NOT be fed by the server page (tasks/[id]/page.tsx
// hand-duplicates its selection set and already carries a drift warning).
//
// The live tick is client-side and pure (AC 36): one setInterval(…, 1000)
// bumping a nowMs state; the displayed value is
// formatElapsed(elapsedSeconds(startTime, nowMs)). No subscription, no
// polling, no fifth EventEmitter. clearInterval on unmount AND when the timer
// stops — the effect cleanup covers both.
//
// Accessibility (AC 37): the per-second readout is aria-live="off"
// (announcing every second is a screen-reader denial-of-service); a separate
// visually-hidden aria-live="polite" region announces only the transitions.
// Start/Stop are ≥44×44px (size="lg" = h-11) and keyboard operable.
export function TaskTimerWidget({ taskId }: { taskId: string }): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const canUpdate = usePermission('TASK', 'UPDATE')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [announcement, setAnnouncement] = useState('')

  const { data: active, isLoading: activeLoading } = useQuery({
    queryKey: ['activeTimeEntry'],
    queryFn: getActiveTimeEntry,
  })

  // Today's total on this task — stopped entries only; the running one (if
  // any) contributes its live elapsed below.
  const today = formatDateInput(todayUtc())
  const { data: todayEntries } = useQuery({
    queryKey: ['timeEntries', { taskId, startFrom: today, startTo: today }],
    queryFn: () => getTimeEntries({ taskId, startFrom: today, startTo: today }, { pageSize: 100 }),
  })

  const isRunningHere = active !== null && active !== undefined && active.taskId === taskId
  const isRunningElsewhere = active !== null && active !== undefined && active.taskId !== taskId

  // AC 36: the interval lives only while a timer is running on this task.
  // window.setInterval/clearInterval explicitly — the bare globals are
  // undefined under jest's fake timers in the jsdom environment.
  useEffect(() => {
    if (!isRunningHere) return
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [isRunningHere])

  const stoppedToday = (todayEntries?.items ?? []).reduce(
    (sum, entry) => sum + entry.durationSeconds,
    0,
  )
  const liveSeconds = isRunningHere ? elapsedSeconds(active!.startTime, nowMs) : 0
  const todayTotalSeconds = stoppedToday + liveSeconds

  const startMutation = useMutation({
    mutationFn: () => startTimer(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeTimeEntry'] })
      queryClient.invalidateQueries({ queryKey: ['timeEntries'] })
      setAnnouncement('Timer started')
    },
  })

  const stopMutation = useMutation({
    mutationFn: () => stopTimer(active!.id),
    onSuccess: (stopped) => {
      queryClient.invalidateQueries({ queryKey: ['activeTimeEntry'] })
      queryClient.invalidateQueries({ queryKey: ['timeEntries'] })
      setAnnouncement(`Timer stopped, ${formatDurationShort(stopped.durationSeconds)} recorded`)
    },
  })

  if (activeLoading) return null

  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Time tracker</h2>
        <span className="text-[12.5px] text-[#8c8c96]">
          Today: {formatDurationShort(todayTotalSeconds)}
        </span>
      </div>

      {isRunningHere ? (
        <div className="flex items-center justify-between gap-3">
          {/* AC 37: the per-second readout must NOT be announced every second. */}
          <span
            aria-live="off"
            className="font-mono text-[20px] font-semibold tracking-[-0.01em] text-[#1b1b1f]"
          >
            {formatElapsed(elapsedSeconds(active!.startTime, nowMs))}
          </span>
          {canUpdate ? (
            <Button
              type="button"
              size="lg"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : null}
        </div>
      ) : null}

      {isRunningElsewhere ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[12.5px] leading-[1.5] text-[#8c8c96]">
            Timer running on{' '}
            <Link
              href={`/tasks/${active!.taskId}`}
              className="font-medium text-[#4338ca] hover:underline"
            >
              {active!.task.title}
            </Link>
          </p>
          {canUpdate ? (
            // AC 35: never a silently dead button — the reason is visible above.
            <Button type="button" size="lg" disabled title="Stop the running timer first">
              <Play className="h-4 w-4" />
              Start timer
            </Button>
          ) : null}
        </div>
      ) : null}

      {!isRunningHere && !isRunningElsewhere && canUpdate ? (
        <Button
          type="button"
          size="lg"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
        >
          <Play className="h-4 w-4" />
          Start timer
        </Button>
      ) : null}

      {/* AC 37: transitions only — the sr-only region announces the last
          start/stop event, never the ticking readout. */}
      <div className="border-t border-[#f2f2f5] pt-2.5">
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>
    </section>
  )
}
