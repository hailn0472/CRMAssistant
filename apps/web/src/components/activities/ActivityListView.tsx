'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare, ChevronLeft, ChevronRight } from 'lucide-react'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { usePermission } from '@/hooks/usePermission'
import { useDebounce } from '@/hooks/useDebounce'
import { getTasks, type Task, type TaskFilter } from '@/services/task.service'
import { fetchActivityFeed } from '@/services/activity.service'
import type { ActivityFeedItem } from '@/types/activity.types'
import { ACTIVITY_TYPE_LABELS } from '@/types/activity.types'
import { ActivityIcon } from '@/components/contacts/ActivityIcon'
import {
  formatDueDate,
  resolveDueStatus,
  TASK_DUE_COLOR,
  TASK_PRIORITY_COLOR,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_DOT_COLOR,
  TASK_STATUS_LABELS,
} from '@/lib/task-format'
import type { ActivityFilters } from './ActivityFilterBar'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

const STATUS_DOT_COLOR = TASK_STATUS_DOT_COLOR
const PRIORITY_COLOR = TASK_PRIORITY_COLOR
const DUE_COLOR = TASK_DUE_COLOR

const SORTABLE_FIELDS = ['DUE_DATE', 'PRIORITY', 'CREATED_AT'] as const
type SortableField = (typeof SORTABLE_FIELDS)[number]

function Pagination({
  page,
  totalPages,
  total,
  unit,
  onChange,
}: {
  page: number
  totalPages: number
  total: number
  unit: string
  onChange: (p: number) => void
}): React.JSX.Element {
  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const result: (number | 'ellipsis')[] = [1]
    if (page > 3) result.push('ellipsis')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      result.push(i)
    }
    if (page < totalPages - 2) result.push('ellipsis')
    result.push(totalPages)
    return result
  }, [page, totalPages])

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[12.5px] text-[#8c8c96]">
        <strong className="text-[#4b4b55]">{total}</strong> {unit}
      </span>
      <div className="flex items-center gap-[5px]">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border border-[#e6e6eb] bg-white px-2 text-[#8c8c96] transition-colors hover:bg-[#f4f4f6] disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span
              key={`e${i}`}
              className="flex h-[30px] w-6 select-none items-center justify-center px-[3px] text-[12.5px] text-[#b4b4bd]"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-label={`Go to page ${p}`}
              onClick={() => onChange(p)}
              className={cn(
                'flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border px-2 text-[12.5px] font-medium transition-colors',
                p === page
                  ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white shadow-sm'
                  : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:bg-[#f4f4f6]',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border border-[#e6e6eb] bg-white px-2 text-[#8c8c96] transition-colors hover:bg-[#f4f4f6] disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function assigneeInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

function TaskTypeCell(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#eef2ff]">
        <CheckSquare className="h-3.5 w-3.5 text-indigo-600" />
      </span>
      <span className="text-[12.5px] text-[#4b4b55]">Task</span>
    </span>
  )
}

/**
 * Story 4.4 (AC 24-27): the unified List table. Task rows fill every column;
 * activity rows render an em-dash in the task-only columns (Status / Priority
 * / Assignee). Type cells pair an icon with a TEXT label, never colour alone
 * (NFR16/WCAG AA, AC 25). All four states come from @/components/shared.
 */
export function ActivityListView({
  filters,
  onFiltersChange,
}: {
  filters: ActivityFilters
  onFiltersChange: (filters: ActivityFilters) => void
}): React.JSX.Element {
  const [page, setPage] = useState(1)
  // Search is debounced at the query-build site — one request per keystroke
  // was the exact bug 8363e5a fixed (AC 23).
  const debouncedSearch = useDebounce(filters.search, 300)

  const canReadTasks = usePermission('TASK', 'READ')
  const canReadActivities = usePermission('CONTACT', 'READ')

  const isTasks = filters.recordType === 'tasks'

  const taskFilter: TaskFilter = {
    search: debouncedSearch || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    assignedTo: filters.assignee?.id || undefined,
    dueDateFrom: filters.dateFrom || undefined,
    dueDateTo: filters.dateTo || undefined,
  }

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'activities', page, taskFilter, filters.sort],
    queryFn: () => getTasks(page, PAGE_SIZE, taskFilter, filters.sort ?? undefined),
    enabled: isTasks && canReadTasks,
  })

  const activitiesQuery = useQuery({
    queryKey: [
      'activities',
      'feed',
      page,
      debouncedSearch,
      filters.activityType,
      filters.dateFrom,
      filters.dateTo,
    ],
    queryFn: () =>
      fetchActivityFeed(
        {
          search: debouncedSearch || undefined,
          type: filters.activityType || undefined,
          createdFrom: filters.dateFrom || undefined,
          createdTo: filters.dateTo || undefined,
        },
        page,
        PAGE_SIZE,
      ),
    enabled: !isTasks && canReadActivities,
  })

  // Permission gating degrades per-section (AC 13): a TASK:READ-only user still
  // gets the task half; the activity half shows PermissionLimitedState.
  const permissionOk = isTasks ? canReadTasks : canReadActivities
  if (!permissionOk) {
    return (
      <PermissionLimitedState
        message={
          isTasks
            ? 'You do not have permission to view tasks.'
            : 'You do not have permission to view the activity feed.'
        }
      />
    )
  }

  const query = isTasks ? tasksQuery : activitiesQuery
  const { data, error, isLoading, refetch } = query

  if (isLoading) return <TableSkeleton rows={5} columns={7} />

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Unable to load records.'}
        onRetry={() => refetch()}
      />
    )
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  if (items.length === 0 && !isFiltered(filters)) {
    return isTasks ? (
      <EmptyState
        title="No tasks yet"
        description="Create your first task to start tracking your work."
      />
    ) : (
      <EmptyState
        title="No activities yet"
        description="Activities appear here as your team logs calls, notes and task completions."
      />
    )
  }

  function toggleSort(field: SortableField): void {
    if (!isTasks) return
    if (filters.sort?.field !== field) {
      onFiltersChange({ ...filters, sort: { field, direction: 'ASC' } })
      setPage(1)
      return
    }
    if (filters.sort.direction === 'ASC') {
      onFiltersChange({ ...filters, sort: { field, direction: 'DESC' } })
      return
    }
    onFiltersChange({ ...filters, sort: null })
  }

  function ariaSortFor(field: SortableField): 'ascending' | 'descending' | undefined {
    if (filters.sort?.field !== field) return undefined
    return filters.sort.direction === 'ASC' ? 'ascending' : 'descending'
  }

  return (
    <div className="space-y-4">
      <ResponsiveTableWrapper>
        <table className="w-full min-w-[1050px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-[#f2f2f5] bg-[#fafafb] text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
              <th className="py-2.5 pl-[18px] pr-4">Title</th>
              <th className="py-2.5 pr-4">Type</th>
              <th className="py-2.5 pr-4">Status</th>
              <th className="py-2.5 pr-4">Priority</th>
              <th className="py-2.5 pr-4">Assignee</th>
              <th
                className="cursor-pointer select-none py-2.5 pr-4 hover:text-[#4b4b55]"
                aria-sort={isTasks ? ariaSortFor('DUE_DATE') : 'descending'}
                onClick={() => toggleSort('DUE_DATE')}
              >
                Date{' '}
                {isTasks && filters.sort?.field === 'DUE_DATE'
                  ? filters.sort.direction === 'ASC'
                    ? '↑'
                    : '↓'
                  : ''}
              </th>
              <th className="py-2.5 pr-[18px]">Related</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f4f4f7]">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-[18px] py-10 text-center text-[13px] text-[#8c8c96]">
                  No records match these filters.
                </td>
              </tr>
            ) : isTasks ? (
              (items as Task[]).map((task) => <TaskRow key={task.id} task={task} />)
            ) : (
              (items as ActivityFeedItem[]).map((activity) => (
                <ActivityRow key={activity.id} activity={activity} />
              ))
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      {items.length > 0 ? (
        <div className="border-t border-[#f2f2f5] px-[18px] py-3.5">
          <Pagination
            page={data?.page ?? page}
            totalPages={totalPages}
            total={total}
            unit={isTasks ? 'tasks' : 'activities'}
            onChange={setPage}
          />
        </div>
      ) : null}
    </div>
  )
}

function TaskRow({ task }: { task: Task }): React.JSX.Element {
  const dueStatus = resolveDueStatus(
    { status: task.status, dueDate: task.dueDate ? new Date(task.dueDate) : null },
    new Date(),
  )
  const isDone = task.status === 'COMPLETED' || task.status === 'CANCELLED'
  return (
    <tr
      className="cursor-pointer transition-colors hover:bg-[#fafafb]"
      onClick={() => (window.location.href = `/tasks/${task.id}`)}
    >
      <td className="max-w-[320px] py-3 pl-[18px] pr-4">
        <span
          className="block truncate font-medium"
          style={{ color: isDone ? '#8c8c96' : '#1b1b1f' }}
        >
          {task.title}
        </span>
      </td>
      <td className="py-3 pr-4">
        <TaskTypeCell />
      </td>
      <td className="py-3 pr-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f4f6] px-2 py-[3px] text-[11.5px] font-medium text-[#4b4b55]">
          <span
            className="block h-[5px] w-[5px] rounded-full"
            style={{ background: STATUS_DOT_COLOR[task.status] }}
          />
          {TASK_STATUS_LABELS[task.status]}
        </span>
      </td>
      <td
        className="py-3 pr-4 text-[12.5px] font-semibold"
        style={{ color: PRIORITY_COLOR[task.priority] }}
      >
        {TASK_PRIORITY_LABELS[task.priority]}
      </td>
      <td className="py-3 pr-4">
        {task.assignee ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#f0f0f3] text-[9.5px] font-semibold text-[#6b6b76]">
              {assigneeInitials(task.assignee.firstName, task.assignee.lastName)}
            </span>
            <span className="truncate text-[#4b4b55]">
              {task.assignee.firstName} {task.assignee.lastName}
            </span>
          </div>
        ) : (
          <span className="italic text-[#c0c0c8]">&mdash;</span>
        )}
      </td>
      <td
        className="whitespace-nowrap py-3 pr-4 font-mono text-[12px]"
        style={{ color: DUE_COLOR[dueStatus] }}
      >
        {formatDueDate(task.dueDate)}
      </td>
      <td className="max-w-[220px] py-3 pr-[18px] text-[12.5px] text-[#8c8c96]">
        {task.contact ? (
          <Link href={`/contacts/${task.contact.id}`} className="text-indigo-600 hover:underline">
            {task.contact.firstName} {task.contact.lastName}
          </Link>
        ) : null}
        {task.contact && task.deal ? ' · ' : null}
        {task.deal ? (
          <Link
            href={`/deals/${task.deal.id}`}
            className="truncate text-indigo-600 hover:underline"
          >
            {task.deal.title}
          </Link>
        ) : null}
        {!task.contact && !task.deal ? (
          <span className="italic text-[#c0c0c8]">&mdash;</span>
        ) : null}
      </td>
    </tr>
  )
}

function ActivityRow({ activity }: { activity: ActivityFeedItem }): React.JSX.Element {
  return (
    <tr className="cursor-pointer transition-colors hover:bg-[#fafafb]">
      <td className="max-w-[320px] py-3 pl-[18px] pr-4">
        <span className="block truncate font-medium text-[#1b1b1f]">{activity.title}</span>
      </td>
      <td className="py-3 pr-4">
        <span className="inline-flex items-center gap-2">
          <ActivityIcon type={activity.type} size="sm" />
          <span className="text-[12.5px] text-[#4b4b55]">
            {ACTIVITY_TYPE_LABELS[activity.type]}
          </span>
        </span>
      </td>
      <td className="py-3 pr-4 text-[#c0c0c8]">&mdash;</td>
      <td className="py-3 pr-4 text-[#c0c0c8]">&mdash;</td>
      <td className="py-3 pr-4 text-[#c0c0c8]">&mdash;</td>
      <td className="whitespace-nowrap py-3 pr-4 font-mono text-[12px] text-[#6b6b76]">
        {new Date(activity.createdAt).toLocaleDateString()}
      </td>
      <td className="max-w-[220px] py-3 pr-[18px] text-[12.5px] text-[#8c8c96]">
        {activity.contact ? (
          <Link
            href={`/contacts/${activity.contact.id}`}
            className="text-indigo-600 hover:underline"
          >
            {activity.contact.firstName} {activity.contact.lastName}
          </Link>
        ) : (
          <span className="italic text-[#c0c0c8]">&mdash;</span>
        )}
      </td>
    </tr>
  )
}

function isFiltered(filters: ActivityFilters): boolean {
  return (
    filters.search !== '' ||
    filters.status !== '' ||
    filters.priority !== '' ||
    filters.assignee !== null ||
    filters.activityType !== '' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== ''
  )
}
