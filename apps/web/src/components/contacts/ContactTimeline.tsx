'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-hot-toast'
import { fetchTimeline, addContactNote } from '@/services/activity.service'
import { TimelineCard } from './TimelineCard'
import { NoteComposer } from './NoteComposer'
import { TimelineFilter } from './TimelineFilter'
import type { Activity, ActivityFilterType, ActivityTypeValue } from '@/types/activity.types'
import { SALES_TYPES, SYSTEM_TYPES } from '@/types/activity.types'

const PAGE_SIZE = 20

type ContactTimelineProps = {
  contactId: string
}

function filterActivities(activities: Activity[], filter: ActivityFilterType): Activity[] {
  if (filter === 'ALL') return activities

  const allowedTypes: ActivityTypeValue[] = filter === 'SALES' ? SALES_TYPES : SYSTEM_TYPES

  return activities.filter((a) => allowedTypes.includes(a.type))
}

export function ContactTimeline({ contactId }: ContactTimelineProps): React.JSX.Element {
  const [activities, setActivities] = useState<Activity[]>([])
  const [filteredActivities, setFilteredActivities] = useState<Activity[]>([])
  const [pageInfo, setPageInfo] = useState<{
    hasNextPage: boolean
    endCursor: string | null
  }>({ hasNextPage: false, endCursor: null })
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ActivityFilterType>('ALL')
  const [showComposer, setShowComposer] = useState(false)
  const [isAddingNote, setIsAddingNote] = useState(false)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Load initial data
  const loadTimeline = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await fetchTimeline(contactId, PAGE_SIZE)
      if (!mountedRef.current) return
      setActivities(result.edges.map((e) => e.node))
      setPageInfo(result.pageInfo)
      setTotalCount(result.totalCount)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load timeline')
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
        loadedRef.current = true
      }
    }
  }, [contactId])

  useEffect(() => {
    loadTimeline()
  }, [loadTimeline])

  // Update filtered activities when activities or filter changes
  useEffect(() => {
    setFilteredActivities(filterActivities(activities, filter))
  }, [activities, filter])

  // Infinite scroll via Intersection Observer
  useEffect(() => {
    if (!pageInfo.hasNextPage || isLoadingMore || !sentinelRef.current) return

    const observer = new IntersectionObserver(
      async (entries) => {
        const target = entries[0]
        if (!target?.isIntersecting) return

        setIsLoadingMore(true)
        try {
          const result = await fetchTimeline(contactId, PAGE_SIZE, pageInfo.endCursor ?? undefined)
          if (!mountedRef.current) return
          setActivities((prev) => [...prev, ...result.edges.map((e) => e.node)])
          setPageInfo(result.pageInfo)
        } catch (err) {
          if (mountedRef.current) {
            toast.error(err instanceof Error ? err.message : 'Failed to load more activities')
          }
        } finally {
          if (mountedRef.current) {
            setIsLoadingMore(false)
          }
        }
      },
      { threshold: 0.1 },
    )

    const el = sentinelRef.current
    if (el) observer.observe(el)

    return () => observer.disconnect()
  }, [contactId, pageInfo, isLoadingMore])

  // Handle note submission
  const handleAddNote = useCallback(
    async (text: string) => {
      setIsAddingNote(true)
      // Optimistic update
      const optimisticActivity: Activity = {
        id: `optimistic-${Date.now()}`,
        contactId,
        type: 'NOTE_ADDED',
        title: text.slice(0, 80) + (text.length > 80 ? '...' : ''),
        description: text,
        createdAt: new Date().toISOString(),
        createdBy: 'You',
        // A manual note is never auto-logged (Story 4.2, AC 3).
        source: null,
      }

      setActivities((prev) => [optimisticActivity, ...prev])
      setTotalCount((prev) => prev + 1)
      setShowComposer(false)

      try {
        const result = await addContactNote(contactId, text.slice(0, 80), text)
        if (!mountedRef.current) return
        // Replace optimistic with real
        setActivities((prev) =>
          prev.map((a) =>
            a.id === optimisticActivity.id
              ? {
                  id: result.id,
                  contactId: result.contactId,
                  type: result.type as ActivityTypeValue,
                  title: result.title,
                  description: result.description,
                  createdAt: result.createdAt,
                  createdBy: result.createdBy,
                  source: result.source,
                }
              : a,
          ),
        )
      } catch (err) {
        if (!mountedRef.current) return
        // Remove optimistic on failure
        setActivities((prev) => prev.filter((a) => a.id !== optimisticActivity.id))
        setTotalCount((prev) => Math.max(0, prev - 1))
        toast.error(err instanceof Error ? err.message : 'Failed to save note')
      } finally {
        setIsAddingNote(false)
      }
    },
    [contactId],
  )

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="flex gap-2">
          <div className="h-8 w-16 animate-pulse rounded bg-slate-200" />
          <div className="h-8 w-16 animate-pulse rounded bg-slate-200" />
          <div className="h-8 w-16 animate-pulse rounded bg-slate-200" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200" />
            <div className="flex-1 space-y-2 rounded-lg border p-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={loadTimeline}
          className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }

  // Empty state
  if (totalCount === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Activity Timeline</h3>
          <button
            type="button"
            onClick={() => setShowComposer(!showComposer)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Note
          </button>
        </div>

        {showComposer && <NoteComposer onSubmit={handleAddNote} isSubmitting={isAddingNote} />}

        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm text-slate-500">
            No activity recorded yet — log your first interaction
          </p>
        </div>
      </div>
    )
  }

  // Main timeline
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">
          Activity Timeline
          <span className="ml-2 text-sm font-normal text-slate-400">
            ({totalCount} {totalCount === 1 ? 'activity' : 'activities'})
          </span>
        </h3>
        <button
          type="button"
          onClick={() => setShowComposer(!showComposer)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showComposer ? 'Cancel' : 'Add Note'}
        </button>
      </div>

      {showComposer && <NoteComposer onSubmit={handleAddNote} isSubmitting={isAddingNote} />}

      <TimelineFilter activeFilter={filter} onFilterChange={setFilter} />

      <div className="mt-4">
        {filteredActivities.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No {filter === 'SALES' ? 'sales' : 'system'} activities
          </p>
        ) : (
          filteredActivities.map((activity, index) => (
            <TimelineCard
              key={activity.id}
              type={activity.type}
              title={activity.title}
              description={activity.description}
              createdAt={activity.createdAt}
              createdBy={activity.createdBy}
              // Story 4.2 (AC 48): pass the auto-log discriminator through so
              // TimelineCard can render the "Auto" badge for source != null.
              source={activity.source}
              isLast={index === filteredActivities.length - 1 && !pageInfo.hasNextPage}
            />
          ))
        )}

        {/* Sentinel for infinite scroll */}
        {pageInfo.hasNextPage && (
          <div ref={sentinelRef} className="py-4 text-center">
            {isLoadingMore ? (
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
                <span className="text-sm text-slate-400">Loading more...</span>
              </div>
            ) : (
              <div className="h-4" />
            )}
          </div>
        )}

        {!pageInfo.hasNextPage && activities.length > 0 && (
          <p className="py-4 text-center text-sm text-slate-400">No more activities</p>
        )}
      </div>
    </div>
  )
}
