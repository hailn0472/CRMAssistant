'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

import {
  createTaskFromTemplate,
  deleteTaskTemplate,
  getTaskTemplates,
} from '@/services/task.service'
import { usePermission } from '@/hooks/usePermission'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { Button } from '@/components/ui/button'
import { TaskTemplateForm } from './TaskTemplateForm'
import { TASK_PRIORITY_LABELS, formatDueDate } from '@/lib/task-format'
import type { TaskTemplate } from '@/services/task.service'

export function TaskTemplatesManager(): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null)

  const canRead = usePermission('TASK', 'READ')
  const canCreate = usePermission('TASK', 'CREATE')
  const canUpdate = usePermission('TASK', 'UPDATE')
  const canDelete = usePermission('TASK', 'DELETE')

  const { data, isLoading, error } = useQuery({
    queryKey: ['taskTemplates'],
    queryFn: () => getTaskTemplates(1, 100),
    enabled: canRead,
  })

  const createFromTemplateMutation = useMutation({
    mutationFn: (templateId: string) => createTaskFromTemplate(templateId, {}),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      const dueText = task.dueDate ? ` due ${formatDueDate(task.dueDate)}` : ' with no due date'
      toast.success(`Task created from template${dueText}`)
      router.push(`/tasks/${task.id}`)
      router.refresh()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create task from template')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTaskTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskTemplates'] })
      toast.success('Task template deleted')
    },
    onError: () => {
      toast.error('Failed to delete task template')
    },
  })

  if (!canRead) {
    return <PermissionLimitedState message="You do not have permission to view task templates." />
  }

  if (isLoading) return <TableSkeleton rows={5} columns={4} />

  if (error) return <ErrorState message="Failed to load task templates" />

  const handleEdit = (template: TaskTemplate): void => {
    setEditingTemplate(template)
    setFormOpen(true)
  }

  const handleCreate = (): void => {
    setEditingTemplate(null)
    setFormOpen(true)
  }

  const handleCreateFromTemplate = (template: TaskTemplate): void => {
    createFromTemplateMutation.mutate(template.id)
  }

  const handleDelete = (template: TaskTemplate): void => {
    if (!confirm(`Delete task template "${template.name}"?`)) return
    deleteMutation.mutate(template.id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Task templates</h2>
          <p className="mt-1 text-sm text-slate-500">
            Reusable patterns for creating tasks in one click.
          </p>
        </div>
        {canCreate ? (
          <Button variant="default" size="sm" className="gap-1.5" onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5" />
            Add template
          </Button>
        ) : null}
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          title="No task templates yet"
          description="Add templates to reuse common task patterns."
        />
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <caption className="sr-only">Task templates</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-4 py-3">
                  Name
                </th>
                <th scope="col" className="px-4 py-3">
                  Task title
                </th>
                <th scope="col" className="px-4 py-3">
                  Priority
                </th>
                <th scope="col" className="px-4 py-3">
                  Due in
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((template) => (
                <tr key={template.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{template.name}</td>
                  <td className="px-4 py-3">{template.title}</td>
                  <td className="px-4 py-3">{TASK_PRIORITY_LABELS[template.defaultPriority]}</td>
                  <td className="px-4 py-3">
                    {template.defaultDueInDays === null
                      ? 'No due date'
                      : `${template.defaultDueInDays} day${template.defaultDueInDays === 1 ? '' : 's'}`}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {canCreate ? (
                        <button
                          type="button"
                          onClick={() => handleCreateFromTemplate(template)}
                          className="inline-flex h-11 min-w-[44px] items-center justify-center rounded px-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                          aria-label={`Create task from ${template.name}`}
                        >
                          Use
                        </button>
                      ) : null}
                      {canUpdate ? (
                        <button
                          type="button"
                          onClick={() => handleEdit(template)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                          aria-label="Edit template"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(template)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                          aria-label="Delete template"
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      <TaskTemplateForm
        template={editingTemplate}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingTemplate(null)
        }}
      />
    </div>
  )
}
