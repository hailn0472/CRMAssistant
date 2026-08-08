'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTaskDependencies,
  addTaskDependency,
  removeTaskDependency,
  getTasks,
} from '@/services/task.service'
import { usePermission } from '@/hooks/usePermission'
import { useDebounce } from '@/hooks/useDebounce'
import { TASK_STATUS_DOT_COLOR, TASK_STATUS_LABELS, formatDueDate } from '@/lib/task-format'
import type { TaskDependencyNode, TaskDependencyView, Task } from '@/services/task.service'
import toast from 'react-hot-toast'

type TaskDependenciesSectionProps = {
  taskId: string
}

export function TaskDependenciesSection({
  taskId,
}: TaskDependenciesSectionProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const canRead = usePermission('TASK', 'READ')
  const canUpdate = usePermission('TASK', 'UPDATE')

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebounce(searchTerm, 300)

  // Fetch dependency view
  const {
    data: view,
    isLoading,
    error,
    refetch,
  } = useQuery<TaskDependencyView>({
    queryKey: ['taskDependencies', taskId],
    queryFn: () => getTaskDependencies(taskId),
    enabled: canRead,
  })

  // Search tasks for adding dependencies
  const { data: searchResults } = useQuery<{ items: Task[] }>({
    queryKey: ['tasks', 'search', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return { items: [] }
      const result = await getTasks(1, 20, { search: debouncedSearch })
      return { items: result.items }
    },
    enabled: searchOpen && debouncedSearch.length > 0,
  })

  // Add dependency mutation
  const addMutation = useMutation({
    mutationFn: (dependsOnTaskId: string) => addTaskDependency(taskId, dependsOnTaskId),
    onSuccess: (newView) => {
      queryClient.setQueryData(['taskDependencies', taskId], newView)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setSearchOpen(false)
      setSearchTerm('')
      toast.success('Dependency added')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add dependency')
    },
  })

  // Remove dependency mutation
  const removeMutation = useMutation({
    mutationFn: (dependencyId: string) => removeTaskDependency(dependencyId),
    onSuccess: (newView) => {
      queryClient.setQueryData(['taskDependencies', taskId], newView)
      toast.success('Dependency removed')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove dependency')
    },
  })

  const handleRemove = useCallback(
    (dependencyId: string, taskTitle: string | null) => {
      const confirmed = window.confirm(
        `Remove dependency "${taskTitle || 'Restricted task'}"? The dependent task will become unblocked.`,
      )
      if (confirmed) {
        removeMutation.mutate(dependencyId)
      }
    },
    [removeMutation],
  )

  // Filter out current task and already-linked tasks from search results
  const linkedTaskIds = new Set([
    taskId,
    ...(view?.blockedBy.map((n) => n.taskId) ?? []),
    ...(view?.blocking.map((n) => n.taskId) ?? []),
  ])

  const filteredResults = (searchResults?.items ?? []).filter((t) => !linkedTaskIds.has(t.id))

  if (!canRead) return <></>
  if (isLoading) {
    return (
      <section className="flex flex-col gap-[9px] rounded-[14px] border border-[#ececf0] bg-white px-5 py-[18px]">
        <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Dependencies</h2>
        <div className="text-[13px] text-[#a0a0aa]">Loading...</div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="flex flex-col gap-[9px] rounded-[14px] border border-[#ececf0] bg-white px-5 py-[18px]">
        <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Dependencies</h2>
        <div className="text-[13px] text-[#b91c1c]">Failed to load dependencies</div>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-[12.5px] text-[#4338ca] hover:underline"
        >
          Retry
        </button>
      </section>
    )
  }

  const isEmpty = !view || (view.blockedBy.length === 0 && view.blocking.length === 0)

  return (
    <section className="flex flex-col gap-[9px] rounded-[14px] border border-[#ececf0] bg-white px-5 py-[18px]">
      <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Dependencies</h2>

      {isEmpty ? (
        <p className="m-0 text-[13.5px] text-[#a0a0aa]">No dependencies yet.</p>
      ) : (
        <>
          {view.blockedBy.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-[#8c8c96]">Blocked by</span>
              {view.blockedBy.map((node) => (
                <DependencyRow
                  key={node.dependencyId}
                  node={node}
                  onRemove={
                    canUpdate ? () => handleRemove(node.dependencyId, node.title) : undefined
                  }
                />
              ))}
            </div>
          )}

          {view.blocking.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-[#8c8c96]">Blocking</span>
              {view.blocking.map((node) => (
                <DependencyRow
                  key={node.dependencyId}
                  node={node}
                  onRemove={
                    canUpdate ? () => handleRemove(node.dependencyId, node.title) : undefined
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Add dependency search */}
      {canUpdate && (
        <div className="relative mt-1">
          {searchOpen ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search tasks to add as dependency..."
                className="w-full rounded-[9px] border border-[#e6e6eb] bg-white px-3 py-2 text-[13px] text-[#1b1b1f] placeholder:text-[#a0a0aa] focus:border-[#4338ca] focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(false)
                    setSearchTerm('')
                  }}
                  className="text-[12.5px] text-[#8c8c96] hover:text-[#1b1b1f]"
                >
                  Cancel
                </button>
              </div>
              {filteredResults.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[9px] border border-[#e6e6eb] bg-white shadow-lg">
                  {filteredResults.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => addMutation.mutate(task.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#1b1b1f] hover:bg-[#f4f4f6]"
                    >
                      <span
                        className="block h-2 w-2 flex-none rounded-full"
                        style={{ background: TASK_STATUS_DOT_COLOR[task.status] }}
                      />
                      <span className="truncate">{task.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="text-[12.5px] text-[#4338ca] hover:underline"
            >
              + Add dependency
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function DependencyRow({
  node,
  onRemove,
}: {
  node: TaskDependencyNode
  onRemove?: () => void
}): React.JSX.Element {
  if (node.restricted) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[9px] bg-[#f8f8fa] px-3 py-2">
        <span className="text-[13px] text-[#8c8c96] italic">Restricted task</span>
        <span
          className="flex-none text-[11px] font-medium"
          style={{ color: TASK_STATUS_DOT_COLOR[node.status] }}
        >
          {TASK_STATUS_LABELS[node.status]}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-[9px] bg-[#f8f8fa] px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="block h-2 w-2 flex-none rounded-full"
          style={{ background: TASK_STATUS_DOT_COLOR[node.status] }}
        />
        <span className="truncate text-[13px] font-medium text-[#1b1b1f]">
          {node.title ?? 'Untitled'}
        </span>
        {node.dueDate && (
          <span className="flex-none text-[11px] text-[#8c8c96]">
            {formatDueDate(node.dueDate)}
          </span>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="flex-none text-[11px] text-[#b91c1c] hover:underline"
          aria-label="Remove dependency"
        >
          ×
        </button>
      )}
    </div>
  )
}
