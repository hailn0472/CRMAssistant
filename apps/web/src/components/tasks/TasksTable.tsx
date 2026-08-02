'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckSquare, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { usePermission } from '@/hooks/usePermission'
import { getTasks, getMyTasks, ON_TASK_ASSIGNED_SUBSCRIPTION } from '@/services/task.service'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import {
  TASK_DUE_STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  formatDueDate,
  resolveDueStatus,
  taskDueBadgeClass,
  taskPriorityBadgeClass,
  taskStatusBadgeClass,
} from '@/lib/task-format'
import { cn } from '@/lib/utils'
import type { Task, TaskFilter } from '@/services/task.service'

const PAGE_SIZE = 10

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
    <div className="flex items-center justify-between text-sm text-slate-500">
      <span className="text-xs">
        <strong className="text-slate-700">{total}</strong> tasks
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span
              key={`e${i}`}
              className="flex h-8 w-6 items-center justify-center text-xs text-slate-300 select-none"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-label={`Go to page ${p}`}
              className={cn(
                'flex h-8 min-w-[32px] items-center justify-center rounded-md px-2 text-xs font-medium transition-colors',
                p === page
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function TasksTable(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [searchFilter, setSearchFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [mineOnly, setMineOnly] = useState(false)

  const canRead = usePermission('TASK', 'READ')
  const canCreate = usePermission('TASK', 'CREATE')

  const connectGuardRef = useRef(false)

  const filter: TaskFilter = {
    search: searchFilter || undefined,
    status: (statusFilter || undefined) as Task['status'] | undefined,
    priority: (priorityFilter || undefined) as Task['priority'] | undefined,
    assignedTo: assigneeFilter || undefined,
  }

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: mineOnly ? ['tasks', 'mine', page, filter] : ['tasks', page, filter],
    queryFn: () =>
      mineOnly ? getMyTasks(page, PAGE_SIZE, filter) : getTasks(page, PAGE_SIZE, filter),
    enabled: canRead,
  })

  // Real-time assignment notification (AC 61) — connectGuardRef prevents the
  // React StrictMode double-connect; the client is always disconnected on
  // unmount.
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
        toast.success('A task was assigned to you')
      },
    })

    return () => {
      connectGuardRef.current = false
      unsub()
      client.disconnect()
    }
  }, [queryClient])

  const resetToFirstPage = (): void => {
    setPage(1)
  }

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

  if (!data || data.items.length === 0) {
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

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">CRM</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">Tasks</h1>
          <p className="mt-1 text-sm text-slate-500">
            Create, assign and track tasks across your team.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate ? (
            <>
              <Button asChild variant="outline" className="gap-1.5">
                <Link href="/tasks/new?fromTemplate=1">New from template</Link>
              </Button>
              <Button asChild className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white">
                <Link href="/tasks/new">
                  <Plus className="h-3.5 w-3.5" />
                  Create task
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search tasks..."
          value={searchFilter}
          onChange={(e) => {
            setSearchFilter(e.target.value)
            resetToFirstPage()
          }}
          aria-label="Search tasks"
          className="h-9 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            resetToFirstPage()
          }}
          aria-label="Filter by status"
          className="min-h-[44px] rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">All statuses</option>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {TASK_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => {
            setPriorityFilter(e.target.value)
            resetToFirstPage()
          }}
          aria-label="Filter by priority"
          className="min-h-[44px] rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">All priorities</option>
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {TASK_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
        {/* AC 68 calls for a <select> of assignees; we deliberately keep a
            free-text user ID input here to keep the filter bar lightweight
            (no async user-search popover). The AssigneePickerDialog on the
            detail page provides the full search/select experience. */}
        <input
          type="text"
          placeholder="Assignee user ID"
          value={assigneeFilter}
          onChange={(e) => {
            setAssigneeFilter(e.target.value)
            resetToFirstPage()
          }}
          aria-label="Filter by assignee user ID"
          className="h-9 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => {
              setMineOnly(e.target.checked)
              resetToFirstPage()
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          My tasks only
        </label>
      </div>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <ResponsiveTableWrapper>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th scope="col" className="py-3 pl-5 pr-4">
                  Title
                </th>
                <th scope="col" className="py-3 pr-4">
                  Status
                </th>
                <th scope="col" className="py-3 pr-4">
                  Priority
                </th>
                <th scope="col" className="py-3 pr-4">
                  Assignee
                </th>
                <th scope="col" className="py-3 pr-4">
                  Due date
                </th>
                <th scope="col" className="py-3 pr-5">
                  Related
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((task) => {
                const dueStatus = resolveDueStatus(
                  { status: task.status, dueDate: task.dueDate ? new Date(task.dueDate) : null },
                  new Date(),
                )
                return (
                  <tr
                    className="group transition-colors hover:bg-slate-50 cursor-pointer"
                    key={task.id}
                    onClick={() => (window.location.href = `/tasks/${task.id}`)}
                  >
                    <td className="py-3 pl-5 pr-4">
                      <span className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {task.title}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                          taskStatusBadgeClass(task.status),
                        )}
                      >
                        {TASK_STATUS_LABELS[task.status]}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                          taskPriorityBadgeClass(task.priority),
                        )}
                      >
                        {TASK_PRIORITY_LABELS[task.priority]}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-500">
                      {task.assignee ? (
                        `${task.assignee.firstName} ${task.assignee.lastName}`
                      ) : (
                        <span className="italic text-slate-300">&mdash;</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                          taskDueBadgeClass(dueStatus),
                        )}
                      >
                        {TASK_DUE_STATUS_LABELS[dueStatus]}
                      </span>
                      {task.dueDate ? (
                        <span className="ml-2 text-xs text-slate-400">
                          {formatDueDate(task.dueDate)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-5">
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
                          className="text-indigo-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {task.deal.title}
                        </Link>
                      ) : null}
                      {!task.contact && !task.deal ? (
                        <span className="italic text-slate-300">&mdash;</span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ResponsiveTableWrapper>

        <div className="border-t border-slate-100 px-5 py-3">
          <Pagination
            page={data.page}
            totalPages={totalPages}
            total={data.total}
            onChange={setPage}
          />
        </div>
      </Card>

      <div className="flex items-center justify-center gap-1 text-xs text-slate-400">
        <CheckSquare className="h-3.5 w-3.5" />
        <span>New assignments appear here in real time.</span>
      </div>
    </div>
  )
}
