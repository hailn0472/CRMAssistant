'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { TimelineCard } from '@/components/contacts/TimelineCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { usePermission } from '@/hooks/usePermission'
import { useDebounce } from '@/hooks/useDebounce'
import { fetchActivityFeed } from '@/services/activity.service'
import type { ActivityFeedItem } from '@/types/activity.types'
import { utcDayKey } from '@/lib/calendar-grid'
import { toUtcMidnight } from '@/lib/task-format'
import type { ActivityFilters } from './ActivityFilterBar'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function todayAndYesterdayKeys(now: Date): { todayKey: string; yesterdayKey: string } {
  const todayKey = utcDayKey(toUtcMidnight(now))
  const yesterday = new Date(toUtcMidnight(now))
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  return { todayKey, yesterdayKey: utcDayKey(yesterday) }
}

function dayLabel(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === todayKey) return `Today · ${DAY_FORMATTER.format(new Date(`${key}T00:00:00.000Z`))}`
  if (key === yesterdayKey)
    return `Yesterday · ${DAY_FORMATTER.format(new Date(`${key}T00:00:00.000Z`))}`
  return DAY_FORMATTER.format(new Date(`${key}T00:00:00.000Z`))
}

/**
 * Story 4.4 (AC 34): activities in createdAt DESC, grouped by day with
 * collapsible sections (default: today + yesterday expanded, older collapsed),
 * rows rendered by the existing TimelineCard in place, infinite scroll via
 * IntersectionObserver with the mountedRef guard (ContactTimeline pattern),
 * and source links: TASK → /tasks/:sourceId, DEAL → /deals/:sourceId, else
 * the contact.
 */
export function ActivityTimelineView({ filters }: { filters: ActivityFilters }): React.JSX.Element {
  const canReadActivities = usePermission('CONTACT', 'READ')

  const [activities, setActivities] = useState<ActivityFeedItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debouncedSearch = useDebounce(filters.search, 300)

  const mountedRef = useRef(true)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)

  // Default expansion: today + yesterday open, everything older collapsed.
  const [{ todayKey, yesterdayKey }] = useState(() => todayAndYesterdayKeys(new Date()))
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () =>
      new Set([
        todayAndYesterdayKeys(new Date()).todayKey,
        todayAndYesterdayKeys(new Date()).yesterdayKey,
      ]),
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const feedFilter = {
    search: debouncedSearch || undefined,
    type: filters.activityType || undefined,
    createdFrom: filters.dateFrom || undefined,
    createdTo: filters.dateTo || undefined,
  }

  const loadPage = useCallback(
    async (nextPage: number) => {
      if (nextPage === 1) setIsLoading(true)
      else setIsLoadingMore(true)
      setError(null)
      try {
        const result = await fetchActivityFeed(feedFilter, nextPage, PAGE_SIZE)
        if (!mountedRef.current) return
        setActivities((prev) => (nextPage === 1 ? result.items : [...prev, ...result.items]))
        setHasMore(result.page * result.pageSize < result.total)
        setPage(nextPage)
        loadedRef.current = true
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load activities')
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedSearch, filters.activityType, filters.dateFrom, filters.dateTo],
  )

  // Reload from page 1 whenever the filters change.
  useEffect(() => {
    void loadPage(1)
  }, [loadPage])

  // Infinite scroll (ContactTimeline.tsx:83 pattern).
  useEffect(() => {
    if (!hasMore || isLoadingMore || !sentinelRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0]
        if (!target?.isIntersecting) return
        void loadPage(page + 1)
      },
      { threshold: 0.1 },
    )

    const el = sentinelRef.current
    if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, isLoadingMore, page, loadPage])

  function toggleDay(key: string): void {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!canReadActivities) {
    return (
      <PermissionLimitedState message="You do not have permission to view the activity feed." />
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-[18px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-[9px] w-[9px] flex-none animate-pulse rounded-full bg-[#f2f2f5]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded-[6px] bg-[#f2f2f5]" />
              <div className="h-3 w-1/2 animate-pulse rounded-[6px] bg-[#f2f2f5]" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          void loadPage(1)
        }}
      />
    )
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        title="No activities yet"
        description="Activities appear here as your team logs calls, notes and task completions."
      />
    )
  }

  // Group by UTC day, preserving the server's createdAt DESC order.
  const groups: Array<{ key: string; items: ActivityFeedItem[] }> = []
  for (const activity of activities) {
    const key = utcDayKey(activity.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(activity)
    else groups.push({ key, items: [activity] })
  }

  return (
    <div className="flex flex-col gap-1 p-[18px]">
      {groups.map((group) => {
        const isExpanded = expandedKeys.has(group.key)
        return (
          <div key={group.key} className="border-b border-[#f4f4f7] py-2 last:border-b-0">
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => toggleDay(group.key)}
              className="flex h-9 w-full items-center gap-1.5 rounded-[8px] px-1 text-left transition-colors hover:bg-[#fafafb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-[#8c8c96]" />
              ) : (
                <ChevronRight className="h-4 w-4 text-[#8c8c96]" />
              )}
              <span className="text-[13px] font-semibold text-[#1b1b1f]">
                {dayLabel(group.key, todayKey, yesterdayKey)}
              </span>
              <span className="text-[12px] text-[#a0a0aa]">
                {group.items.length} {group.items.length === 1 ? 'activity' : 'activities'}
              </span>
            </button>
            {isExpanded ? (
              <div className="pl-7 pt-2">
                {group.items.map((activity, index) => (
                  <SourceLink key={activity.id} activity={activity}>
                    <TimelineCard
                      type={activity.type}
                      title={activity.title}
                      description={activity.description}
                      createdAt={activity.createdAt}
                      createdBy={activity.createdBy}
                      source={activity.source}
                      isLast={index === group.items.length - 1 && !hasMore}
                    />
                  </SourceLink>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      {/* Infinite-scroll sentinel */}
      {hasMore ? (
        <div ref={sentinelRef} className="py-4 text-center">
          {isLoadingMore ? (
            <div className="flex items-center justify-center gap-2">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#e6e6eb] border-t-[#1b1b1f]" />
              <span className="text-[12.5px] text-[#a0a0aa]">Loading more...</span>
            </div>
          ) : (
            <div className="h-4" />
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Wraps a TimelineCard in its source link (AC 34): TASK → /tasks/:sourceId,
 * DEAL → /deals/:sourceId, anything else → the contact page.
 */
function SourceLink({
  activity,
  children,
}: {
  activity: ActivityFeedItem
  children: React.ReactNode
}): React.JSX.Element {
  if (activity.source === 'TASK' && activity.sourceId) {
    return (
      <Link
        href={`/tasks/${activity.sourceId}`}
        className="block rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        {children}
      </Link>
    )
  }
  if (activity.source === 'DEAL' && activity.sourceId) {
    return (
      <Link
        href={`/deals/${activity.sourceId}`}
        className="block rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        {children}
      </Link>
    )
  }
  return (
    <Link
      href={`/contacts/${activity.contactId}`}
      className={cn(
        'block rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
      )}
    >
      {children}
    </Link>
  )
}
