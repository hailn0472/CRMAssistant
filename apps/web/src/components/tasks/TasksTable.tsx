'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckSquare, ChevronLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { useMyPermissions } from '@/hooks/usePermission'
import { getTasks, getMyTasks, ON_TASK_ASSIGNED_SUBSCRIPTION } from '@/services/task.service'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { TaskFilterBar, emptyTaskFilters, type TaskFilters } from '@/components/tasks/TaskFilterBar'
import {
  formatDueDate,
  resolveDueStatus,
  TASK_DUE_COLOR,
  TASK_PRIORITY_COLOR,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_DOT_COLOR,
  TASK_STATUS_LABELS,
} from '@/lib/task-format'
import type { TaskFilter } from '@/services/task.service'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

const STATUS_DOT_COLOR = TASK_STATUS_DOT_COLOR
const PRIORITY_COLOR = TASK_PRIORITY_COLOR
const DUE_COLOR = TASK_DUE_COLOR

function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number
  totalPages: number
  total: number
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
        <strong className="text-[#4b4b55]">{total}</strong> tasks
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

export function TasksTable(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<TaskFilters>(emptyTaskFilters)

  const { hasPermission, isLoading: permissionsLoading } = useMyPermissions()
  const canRead = hasPermission('TASK', 'READ')
  const canCreate = hasPermission('TASK', 'CREATE')

  const connectGuardRef = useRef(false)

  const filter: TaskFilter = {
    search: filters.search || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    assignedTo: filters.assignee?.id || undefined,
  }

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: filters.mineOnly ? ['tasks', 'mine', page, filter] : ['tasks', page, filter],
    queryFn: () =>
      filters.mineOnly ? getMyTasks(page, PAGE_SIZE, filter) : getTasks(page, PAGE_SIZE, filter),
    enabled: canRead,
  })

  // Real-time assignment notification — connectGuardRef prevents the React
  // StrictMode double-connect; the client is always disconnected on unmount.
  useEffect(() => {
    if (connectGuardRef.current) return
    connectGuardRef.current = true

    const client = new GraphqlSubscriptionClient()
    client.connect()

    const unsub = client.subscribe('tasks:assigned', {
      query: ON_TASK_ASSIGNED_SUBSCRIPTION,
      variables: {},
      onData: () => {
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['tasks-stats'] })
        toast.success('A task was assigned to you')
      },
    })

    return () => {
      connectGuardRef.current = false
      unsub()
      client.disconnect()
    }
  }, [queryClient])

  function handleFiltersChange(next: TaskFilters): void {
    setFilters(next)
    setPage(1)
  }

  if (permissionsLoading) return <TableSkeleton rows={5} columns={6} />

  if (!canRead) {
    return <PermissionLimitedState message="You do not have permission to view tasks." />
  }

  if (isLoading) return <TableSkeleton rows={5} columns={6} />

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Unable to load tasks.'}
        onRetry={() => refetch()}
      />
    )
  }

  const isFiltered =
    filters.search !== '' ||
    filters.status !== '' ||
    filters.priority !== '' ||
    filters.assignee !== null ||
    filters.mineOnly

  if ((!data || data.items.length === 0) && !isFiltered) {
    return (
      <EmptyState
        title="No tasks yet"
        description="Create your first task to start tracking your work."
        action={
          canCreate ? (
            <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
              <Link href="/tasks/new">Create task</Link>
            </Button>
          ) : null
        }
      />
    )
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden rounded-2xl border-[#ececf0] shadow-none">
        <TaskFilterBar
          filters={filters}
          onFiltersChange={handleFiltersChange}
          trailing={<span className="text-[12.5px] font-medium text-[#8c8c96]">{total} tasks</span>}
        />

        <ResponsiveTableWrapper>
          <table className="w-full min-w-[1050px] text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-[#f2f2f5] bg-[#fafafb] text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
                <th className="w-9 py-2.5 pl-[18px] pr-2" />
                <th className="py-2.5 pr-4">Task</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4">Priority</th>
                <th className="py-2.5 pr-4">Assignee</th>
                <th className="py-2.5 pr-4">Due</th>
                <th className="py-2.5 pr-[18px]">Related</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f7]">
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-[18px] py-10 text-center text-[13px] text-[#8c8c96]"
                  >
                    No tasks match these filters.
                  </td>
                </tr>
              ) : (
                items.map((task) => {
                  const dueStatus = resolveDueStatus(
                    { status: task.status, dueDate: task.dueDate ? new Date(task.dueDate) : null },
                    new Date(),
                  )
                  const isDone = task.status === 'COMPLETED' || task.status === 'CANCELLED'
                  return (
                    <tr
                      key={task.id}
                      className="cursor-pointer transition-colors hover:bg-[#fafafb]"
                      onClick={() => (window.location.href = `/tasks/${task.id}`)}
                    >
                      <td className="py-3 pl-[18px] pr-2">
                        <input
                          type="checkbox"
                          checked={isDone}
                          readOnly
                          aria-label={`${task.title} ${isDone ? 'completed' : 'not completed'}`}
                          className="h-[15px] w-[15px] rounded border-[#d8d8e0] accent-[#1b1b1f]"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="max-w-[320px] py-3 pr-4">
                        <span
                          className="block truncate font-medium"
                          style={{ color: isDone ? '#8c8c96' : '#1b1b1f' }}
                        >
                          {task.title}
                        </span>
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
                          <Link
                            href={`/contacts/${task.contact.id}`}
                            className="text-indigo-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {task.contact.firstName} {task.contact.lastName}
                          </Link>
                        ) : null}
                        {task.contact && task.deal ? ' · ' : null}
                        {task.deal ? (
                          <Link
                            href={`/deals/${task.deal.id}`}
                            className="truncate text-indigo-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
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
                })
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
              onChange={setPage}
            />
          </div>
        ) : null}
      </Card>

      <div className="flex items-center justify-center gap-1 text-[12.5px] text-[#a0a0aa]">
        <CheckSquare className="h-3.5 w-3.5" />
        <span>New assignments appear here in real time.</span>
      </div>
    </div>
  )
}
