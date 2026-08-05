'use client'

import { useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getTasks, updateTask, type Task } from '@/services/task.service'
import { fetchActivityFeed } from '@/services/activity.service'
import type { ActivityFeedItem } from '@/types/activity.types'
import { ActivityIcon } from '@/components/contacts/ActivityIcon'
import {
  buildDayGrid,
  buildMonthGrid,
  buildWeekGrid,
  groupByDay,
  rangeFor,
  utcDayKey,
  type CalendarMode,
} from '@/lib/calendar-grid'
import { useDebounce } from '@/hooks/useDebounce'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { ErrorState } from '@/components/shared/ErrorState'
import type { ActivityFilters } from './ActivityFilterBar'
import { cn } from '@/lib/utils'

const MAX_CHIPS_PER_CELL = 3
const CALENDAR_PAGE_SIZE = 100

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

type CalendarTask = Task & { kind: 'task' }
type CalendarActivity = ActivityFeedItem & { kind: 'activity' }
type CalendarItem = CalendarTask | CalendarActivity

/**
 * Pure drop resolution (AC 31): maps a dnd-kit drag end onto a reschedule
 * request. Exported for unit tests — dnd-kit's drag simulation is not viable
 * in jsdom, so the mapping is pinned here and both the drag handler and the
 * keyboard/menu path funnel into the SAME mutation (AC 32).
 */
export function resolveTaskDrop(
  activeId: string | number,
  overId: string | number,
  tasks: Task[],
): { taskId: string; targetDayKey: string } | null {
  const active = String(activeId)
  const over = String(overId)
  if (!active.startsWith('task:')) return null
  if (!over.startsWith('cell:')) return null
  const taskId = active.slice('task:'.length)
  const targetDayKey = over.slice('cell:'.length)
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return null
  const currentKey = task.dueDate ? utcDayKey(task.dueDate) : null
  if (currentKey === targetDayKey) return null
  return { taskId, targetDayKey }
}

function TaskChip({
  task,
  onMoveToDate,
}: {
  task: CalendarTask
  onMoveToDate: (taskId: string, dueDateIso: string) => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task:${task.id}`,
  })

  return (
    <div className="flex items-center gap-1">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        title="Drag to reschedule"
        className={cn(
          'flex h-6 min-w-0 flex-1 cursor-grab items-center truncate rounded-[6px] bg-indigo-50 px-1.5 text-[11.5px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100 active:cursor-grabbing',
          isDragging && 'opacity-40',
        )}
      >
        {task.title}
      </div>
      <MoveToDateMenu task={task} onMoveToDate={onMoveToDate} />
    </div>
  )
}

function ActivityChip({ activity }: { activity: CalendarActivity }): React.JSX.Element {
  return (
    <div
      className="flex h-6 min-w-0 items-center gap-1.5 rounded-[6px] bg-[#f4f4f6] px-1.5 text-[11.5px] text-[#4b4b55]"
      title={activity.title}
    >
      <span className="shrink-0">
        <ActivityIcon type={activity.type} size="sm" />
      </span>
      <span className="truncate">{activity.title}</span>
    </div>
  )
}

/**
 * The mandatory non-drag "Move to date…" path (AC 32 — NFR16/WCAG AA:
 * drag-only is a WCAG failure, not a polish item). Performs the identical
 * updateTask mutation as a drop.
 */
function MoveToDateMenu({
  task,
  onMoveToDate,
}: {
  task: CalendarTask
  onMoveToDate: (taskId: string, dueDateIso: string) => void
}): React.JSX.Element {
  const [date, setDate] = useState('')
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Move "${task.title}" to a date`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[#a0a0aa] transition-colors hover:bg-[#f4f4f6] hover:text-[#4b4b55]"
      >
        <CalendarDays className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-3">
        <div className="flex flex-col gap-2.5">
          <p className="text-[12px] font-medium text-[#1b1b1f]">Move to date</p>
          <input
            type="date"
            aria-label="Target date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 rounded-[8px] border border-[#e6e6eb] bg-white px-2 text-[12.5px] text-[#1b1b1f] outline-none focus:border-[#c7c7d1]"
          />
          <button
            type="button"
            disabled={!date}
            onClick={() => {
              if (!date) return
              onMoveToDate(task.id, `${date}T00:00:00.000Z`)
              setDate('')
            }}
            className="inline-flex h-8 items-center justify-center rounded-[8px] border border-[#1b1b1f] bg-[#1b1b1f] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-black disabled:pointer-events-none disabled:opacity-30"
          >
            Move
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DayCell({
  date,
  isCurrentMonth,
  isToday,
  items,
  onShowAll,
  onMoveToDate,
}: {
  date: Date
  isCurrentMonth: boolean
  isToday: boolean
  items: CalendarItem[]
  onShowAll: (date: Date) => void
  onMoveToDate: (taskId: string, dueDateIso: string) => void
}): React.JSX.Element {
  const dayKey = utcDayKey(date)
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${dayKey}` })
  const visible = items.slice(0, MAX_CHIPS_PER_CELL)
  const overflow = items.length - visible.length

  return (
    <div
      ref={setNodeRef}
      data-day={dayKey}
      className={cn(
        'flex min-h-[92px] flex-col gap-1 border-t border-l border-[#ececf0] p-1.5',
        isOver && 'bg-indigo-50/60',
        !isCurrentMonth && 'bg-[#fafafb]',
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium',
          isToday ? 'bg-[#1b1b1f] text-white' : 'text-[#8c8c96]',
        )}
      >
        {date.getUTCDate()}
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        {visible.map((item) =>
          item.kind === 'task' ? (
            <TaskChip key={item.id} task={item} onMoveToDate={onMoveToDate} />
          ) : (
            <ActivityChip key={item.id} activity={item} />
          ),
        )}
        {overflow > 0 ? (
          <button
            type="button"
            onClick={() => onShowAll(date)}
            className="self-start rounded-[6px] px-1 text-[11px] font-semibold text-[#4338ca] hover:underline"
          >
            +{overflow} more
          </button>
        ) : null}
        {items.length === 0 && !isCurrentMonth ? null : null}
      </div>
    </div>
  )
}

/**
 * Story 4.4 (AC 28-33): month/week/day grid built on the pure calendar-grid
 * module, ONE bounded window per record kind merged client-side (AC 29),
 * @dnd-kit drag-to-reschedule for tasks with the mandatory non-drag "Move to
 * date…" menu (AC 31-32), and an "Unscheduled" strip (AC 33). Below `sm` the
 * grid collapses to a stacked day/agenda layout (AC 40) — 44px touch targets.
 */
export function ActivityCalendarView({ filters }: { filters: ActivityFilters }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<CalendarMode>('month')
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeTaskRef = useRef<Task | null>(null)

  const debouncedSearch = useDebounce(filters.search, 300)

  const range = useMemo(() => rangeFor(mode, anchor), [mode, anchor])
  const fromKey = utcDayKey(range.from)
  const toKey = utcDayKey(range.to)

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'calendar', mode, fromKey, toKey],
    queryFn: () =>
      getTasks(1, CALENDAR_PAGE_SIZE, {
        search: debouncedSearch || undefined,
        status: filters.status || undefined,
        priority: filters.priority || undefined,
        assignedTo: filters.assignee?.id || undefined,
        dueDateFrom: fromKey,
        dueDateTo: toKey,
      }),
  })

  const activitiesQuery = useQuery({
    queryKey: ['activities', 'calendar', mode, fromKey, toKey],
    queryFn: () =>
      fetchActivityFeed(
        {
          search: debouncedSearch || undefined,
          type: filters.activityType || undefined,
          createdFrom: fromKey,
          createdTo: toKey,
        },
        1,
        CALENDAR_PAGE_SIZE,
      ),
  })

  // AC 33: tasks without a dueDate cannot appear on the grid — surface them
  // in an "Unscheduled" strip so they are draggable onto the grid.
  const unscheduledQuery = useQuery({
    queryKey: ['tasks', 'unscheduled'],
    queryFn: async () => {
      const page = await getTasks(1, CALENDAR_PAGE_SIZE)
      return page.items.filter((t) => !t.dueDate)
    },
  })

  const reschedule = useMutation({
    mutationFn: ({ taskId, dueDateIso }: { taskId: string; dueDateIso: string | null }) =>
      updateTask(taskId, { dueDate: dueDateIso }),
    onMutate: async ({ taskId, dueDateIso }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] })
      const snapshot = queryClient.getQueriesData({ queryKey: ['tasks'] })
      queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) =>
        updateTaskInCache(old, taskId, dueDateIso),
      )
      return { snapshot }
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data)
      }
      toast.error('Failed to reschedule task. Please try again.')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  function handleMoveToDate(taskId: string, dueDateIso: string): void {
    reschedule.mutate({ taskId, dueDateIso })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  )

  function handleDragStart(event: DragStartEvent): void {
    const id = String(event.active.id)
    if (!id.startsWith('task:')) return
    const taskId = id.slice('task:'.length)
    const task = allTasks.find((t) => t.id === taskId)
    if (!task) return
    setActiveId(id)
    activeTaskRef.current = task
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveId(null)
    const resolved = resolveTaskDrop(event.active.id, event.over?.id ?? '', allTasks)
    if (!resolved) return
    reschedule.mutate({
      taskId: resolved.taskId,
      dueDateIso: `${resolved.targetDayKey}T00:00:00.000Z`,
    })
  }

  const tasks = useMemo(() => (tasksQuery.data?.items ?? []) as CalendarTask[], [tasksQuery.data])
  const activities = useMemo(
    () => (activitiesQuery.data?.items ?? []) as CalendarActivity[],
    [activitiesQuery.data],
  )
  const unscheduledTasks = useMemo(
    () => (unscheduledQuery.data ?? []) as Task[],
    [unscheduledQuery.data],
  )
  const allTasks = useMemo(() => [...tasks, ...unscheduledTasks], [tasks, unscheduledTasks])

  const taskGroups = useMemo(() => groupByDay(tasks, (t) => t.dueDate ?? ''), [tasks])
  const activityGroups = useMemo(() => groupByDay(activities, (a) => a.createdAt), [activities])

  const cells = useMemo(() => {
    if (mode === 'month') return buildMonthGrid(anchor)
    if (mode === 'week') return buildWeekGrid(anchor)
    return buildDayGrid(anchor)
  }, [mode, anchor])

  function itemsFor(date: Date): CalendarItem[] {
    const key = utcDayKey(date)
    const dayTasks = (taskGroups.get(key) ?? []).map((t) => ({ ...t, kind: 'task' as const }))
    const dayActivities = (activityGroups.get(key) ?? []).map((a) => ({
      ...a,
      kind: 'activity' as const,
    }))
    return [...dayTasks, ...dayActivities].sort((a, b) => {
      const aTime =
        a.kind === 'task' ? new Date(a.dueDate ?? 0).getTime() : new Date(a.createdAt).getTime()
      const bTime =
        b.kind === 'task' ? new Date(b.dueDate ?? 0).getTime() : new Date(b.createdAt).getTime()
      return aTime - bTime
    })
  }

  function shiftAnchor(days: number): void {
    const next = new Date(anchor)
    next.setUTCDate(next.getUTCDate() + days)
    setAnchor(next)
  }

  function goToday(): void {
    setAnchor(new Date())
  }

  function openDay(date: Date): void {
    setAnchor(date)
    setMode('day')
  }

  const activeTask = activeTaskRef.current

  if (tasksQuery.isLoading || activitiesQuery.isLoading || unscheduledQuery.isLoading) {
    return <TableSkeleton rows={6} columns={7} />
  }

  if (tasksQuery.error || activitiesQuery.error || unscheduledQuery.error) {
    const message =
      tasksQuery.error?.message ??
      activitiesQuery.error?.message ??
      unscheduledQuery.error?.message ??
      'Unable to load calendar.'
    return (
      <ErrorState
        message={message}
        onRetry={() => {
          void tasksQuery.refetch()
          void activitiesQuery.refetch()
          void unscheduledQuery.refetch()
        }}
      />
    )
  }

  const monthLabel = MONTH_FORMATTER.format(anchor)
  const dayKeys = cells.slice(0, 7).map((c) => WEEKDAY_FORMATTER.format(c.date))

  return (
    <div className="space-y-3 p-[18px]">
      {/* Mode toggle + navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous period"
            onClick={() => shiftAnchor(mode === 'month' ? -7 : mode === 'week' ? -7 : -1)}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#e6e6eb] bg-white text-[#8c8c96] transition-colors hover:bg-[#f4f4f6]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next period"
            onClick={() => shiftAnchor(mode === 'month' ? 7 : mode === 'week' ? 7 : 1)}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#e6e6eb] bg-white text-[#8c8c96] transition-colors hover:bg-[#f4f4f6]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="h-8 rounded-[8px] border border-[#e6e6eb] bg-white px-3 text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            Today
          </button>
          <span className="ml-1 text-[14.5px] font-semibold text-[#1b1b1f]">{monthLabel}</span>
        </div>
        <div
          role="group"
          aria-label="Calendar granularity"
          className="flex items-center rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] p-[3px]"
        >
          {(['month', 'week', 'day'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'h-[26px] rounded-[7px] px-3 text-[12.5px] font-medium capitalize transition-colors',
                mode === m
                  ? 'bg-[#1b1b1f] text-white shadow-sm'
                  : 'text-[#4b4b55] hover:bg-[#f4f4f6]',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* Weekday header (grid only) */}
        <div className="hidden grid-cols-7 sm:grid">
          {dayKeys.map((label, i) => (
            <div
              key={i}
              className="border-t border-[#ececf0] px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Grid (sm+) */}
        <div className="hidden grid-cols-7 sm:grid">
          {cells.map((cell) => (
            <DayCell
              key={utcDayKey(cell.date)}
              date={cell.date}
              isCurrentMonth={cell.isCurrentMonth}
              isToday={cell.isToday}
              items={itemsFor(cell.date)}
              onShowAll={openDay}
              onMoveToDate={handleMoveToDate}
            />
          ))}
        </div>

        {/* Agenda (below sm) — day/agenda layout with 44px targets (AC 40) */}
        <div className="flex flex-col sm:hidden">
          {cells.map((cell) => {
            const items = itemsFor(cell.date)
            return (
              <div key={utcDayKey(cell.date)} className="border-b border-[#ececf0] py-2">
                <div className="flex items-center justify-between px-1">
                  <span
                    className={cn(
                      'text-[12.5px] font-semibold',
                      cell.isToday ? 'text-[#1b1b1f]' : 'text-[#4b4b55]',
                    )}
                  >
                    {WEEKDAY_FORMATTER.format(cell.date)} {cell.date.getUTCDate()}
                  </span>
                  {cell.isToday ? (
                    <span className="rounded-full bg-[#1b1b1f] px-2 py-0.5 text-[10px] font-semibold text-white">
                      Today
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex min-h-11 flex-col gap-1.5">
                  {items.length === 0 ? (
                    <p className="px-1 text-[12px] text-[#b4b4bd]">Nothing scheduled</p>
                  ) : (
                    items.slice(0, 5).map((item) =>
                      item.kind === 'task' ? (
                        <div
                          key={item.id}
                          className="flex h-11 items-center gap-1 rounded-[8px] bg-indigo-50 px-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-indigo-700">
                            {item.title}
                          </span>
                          <MoveToDateMenu task={item} onMoveToDate={handleMoveToDate} />
                        </div>
                      ) : (
                        <div
                          key={item.id}
                          className="flex h-11 items-center gap-2 rounded-[8px] bg-[#f4f4f6] px-2"
                        >
                          <ActivityIcon type={item.type} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#4b4b55]">
                            {item.title}
                          </span>
                        </div>
                      ),
                    )
                  )}
                  {items.length > 5 ? (
                    <button
                      type="button"
                      onClick={() => openDay(cell.date)}
                      className="h-9 self-start rounded-[8px] px-2 text-[12px] font-semibold text-[#4338ca] hover:underline"
                    >
                      +{items.length - 5} more
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        <DragOverlay>
          {activeId && activeTask ? (
            <div className="flex h-6 max-w-[240px] items-center truncate rounded-[6px] bg-indigo-50 px-1.5 text-[11.5px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100">
              {activeTask.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Unscheduled strip (AC 33) */}
      {unscheduledTasks.length > 0 ? (
        <div className="rounded-[10px] border border-dashed border-[#d8d8e0] bg-[#fafafb] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
            Unscheduled ({unscheduledTasks.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unscheduledTasks.map((task) => (
              <TaskChip
                key={task.id}
                task={{ ...task, kind: 'task' }}
                onMoveToDate={handleMoveToDate}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Optimistic cache updater: patches `dueDate` on the matching task inside
 * every cached shape the workspace uses (TaskConnection object or bare Task
 * array). Non-matching data is returned untouched.
 */
export function updateTaskInCache(old: unknown, taskId: string, dueDate: string | null): unknown {
  const patch = (t: unknown): unknown =>
    t && typeof t === 'object' && (t as { id?: unknown }).id === taskId
      ? { ...(t as Record<string, unknown>), dueDate }
      : t
  if (Array.isArray(old)) return old.map(patch)
  if (old && typeof old === 'object' && Array.isArray((old as { items?: unknown[] }).items)) {
    return {
      ...(old as Record<string, unknown>),
      items: (old as { items: unknown[] }).items.map(patch),
    }
  }
  return old
}
