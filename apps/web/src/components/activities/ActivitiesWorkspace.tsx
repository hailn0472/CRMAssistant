'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { MetricsCards } from '@/components/shared/MetricsCards'
import { useActivityRealtime } from './useActivityRealtime'
import { ActivityFilterBar, emptyActivityFilters, type ActivityFilters } from './ActivityFilterBar'
import { ActivityListView } from './ActivityListView'
import { ActivityCalendarView } from './ActivityCalendarView'
import { ActivityTimelineView } from './ActivityTimelineView'
import { fetchActivityFeedStats } from '@/services/activity.service'
import { usePermission } from '@/hooks/usePermission'
import {
  ACTIVITY_VIEWS,
  isActivityView,
  readStoredView,
  writeStoredView,
  type ActivityView,
} from '@/lib/activity-view-preference'
import { cn } from '@/lib/utils'

const VIEW_LABELS: Record<ActivityView, string> = {
  list: 'List',
  calendar: 'Calendar',
  timeline: 'Timeline',
}

/**
 * Story 4.4 (AC 20-23): the Activities workspace shell.
 *
 * - Header (title + description + primary action) in the TasksWorkspace shape.
 * - Metric strip via the SHARED MetricsCards — no private copy (AC 21).
 * - Real tabs: role=tablist/tab, aria-selected, arrow-key navigation (NFR16).
 * - The URL (`?view=`) is the source of truth; localStorage (AC 35) only
 *   supplies the INITIAL value when the query param is absent, read inside a
 *   mount effect — never during render (T10 hydration rule).
 * - Filters live ABOVE the tab control and are shared across all three views
 *   (AC 21) — switching views never resets a filter.
 */
export function ActivitiesWorkspace(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<ActivityFilters>(emptyActivityFilters)
  const [view, setView] = useState<ActivityView>('list')
  const initializedRef = useRef(false)
  const canCreateTask = usePermission('TASK', 'CREATE')

  // One client, both subscriptions, invalidate-on-receipt (AC 37).
  useActivityRealtime()

  // Initial view resolution: URL param → stored preference → 'list'. Runs once
  // on mount; localStorage is never read during render (T10).
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    const param = searchParams.get('view')
    const initial: ActivityView = isActivityView(param) ? param : readStoredView() ?? 'list'
    setView(initial)
  }, [searchParams])

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['activities', 'stats'],
    queryFn: fetchActivityFeedStats,
  })

  const metrics = useMemo(
    () => [
      { label: 'Activities today', value: (stats?.todayCount ?? 0).toLocaleString() },
      { label: 'This week', value: (stats?.weekCount ?? 0).toLocaleString() },
      { label: 'Tasks due today', value: (stats?.tasksDueToday ?? 0).toLocaleString() },
      { label: 'Overdue tasks', value: (stats?.overdueTasks ?? 0).toLocaleString() },
    ],
    [stats],
  )

  function changeView(next: ActivityView): void {
    if (next === view) return
    setView(next)
    writeStoredView(next)
    // The URL is the source of truth — a view survives refresh and is
    // linkable (AC 22). replace() keeps history clean.
    router.replace(`/activities?view=${next}`)
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ACTIVITY_VIEWS.length
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + ACTIVITY_VIEWS.length) % ACTIVITY_VIEWS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = ACTIVITY_VIEWS.length - 1
    changeView(ACTIVITY_VIEWS[nextIndex]!)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
            Activities
          </h1>
          <p className="text-[13.5px] text-[#77777f]">
            List, calendar and timeline views of your tasks and activity feed.
          </p>
        </div>
        {canCreateTask ? (
          <Link
            href="/tasks/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black"
          >
            <Plus className="h-3.5 w-3.5" />
            Create task
          </Link>
        ) : null}
      </div>

      <MetricsCards metrics={metrics} isLoading={statsLoading} variant="divide" />

      <div className="overflow-hidden rounded-2xl border border-[#ececf0] bg-white shadow-none">
        <ActivityFilterBar filters={filters} onFiltersChange={setFilters} />

        <div
          role="tablist"
          aria-label="Activity views"
          className="flex items-center gap-1 border-b border-[#f2f2f5] bg-white px-[18px] pt-2.5"
        >
          {ACTIVITY_VIEWS.map((v, index) => {
            const isActive = view === v
            return (
              <button
                key={v}
                type="button"
                role="tab"
                id={`activities-view-tab-${v}`}
                aria-selected={isActive}
                aria-controls={`activities-view-panel-${v}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => changeView(v)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
                className={cn(
                  'flex h-10 items-center rounded-t-[9px] border border-b-0 px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1',
                  isActive
                    ? 'border-[#ececf0] bg-white text-[#1b1b1f]'
                    : 'border-transparent text-[#8c8c96] hover:bg-[#fafafb] hover:text-[#4b4b55]',
                )}
              >
                {VIEW_LABELS[v]}
              </button>
            )
          })}
        </div>

        <div
          role="tabpanel"
          id={`activities-view-panel-${view}`}
          aria-labelledby={`activities-view-tab-${view}`}
        >
          {view === 'list' ? (
            <ActivityListView filters={filters} onFiltersChange={setFilters} />
          ) : null}
          {view === 'calendar' ? <ActivityCalendarView filters={filters} /> : null}
          {view === 'timeline' ? <ActivityTimelineView filters={filters} /> : null}
        </div>
      </div>
    </div>
  )
}
