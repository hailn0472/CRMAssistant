'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { ArrowLeft, Check, Pencil, Trash2, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { deleteTask, completeTask } from '@/services/task.service'
import { usePermission } from '@/hooks/usePermission'
import { AssigneePickerDialog } from './AssigneePickerDialog'
import {
  TASK_DUE_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  formatDueDate,
  resolveDueStatus,
  taskDueBadgeClass,
  taskPriorityBadgeClass,
  taskStatusBadgeClass,
} from '@/lib/task-format'
import { cn } from '@/lib/utils'
import type { Task } from '@/services/task.service'

type TaskDetailClientProps = {
  task: Task
}

export function TaskDetailClient({ task }: TaskDetailClientProps): React.JSX.Element {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)

  const canUpdate = usePermission('TASK', 'UPDATE')
  const canAssign = usePermission('TASK', 'ASSIGN')
  const canDelete = usePermission('TASK', 'DELETE')

  const dueStatus = resolveDueStatus(
    { status: task.status, dueDate: task.dueDate ? new Date(task.dueDate) : null },
    new Date(),
  )
  const isClosed = task.status === 'COMPLETED' || task.status === 'CANCELLED'

  const handleComplete = async (): Promise<void> => {
    setCompleting(true)
    try {
      await completeTask(task.id)
      toast.success('Task completed and removed from your open list')
      router.refresh()
    } catch {
      toast.error('Failed to complete task')
    } finally {
      setCompleting(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!confirm('Are you sure you want to delete this task?')) return
    setDeleting(true)
    try {
      await deleteTask(task.id)
      toast.success('Task deleted')
      router.push('/tasks')
      router.refresh()
    } catch {
      toast.error('Failed to delete task')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6 p-6 text-slate-950">
      <div className="flex items-center gap-3">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to tasks
        </Link>
      </div>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-lg font-bold text-white shadow-sm">
                {task.title.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {task.title}
                  </h1>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                      taskStatusBadgeClass(task.status),
                    )}
                  >
                    {TASK_STATUS_LABELS[task.status]}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                      taskPriorityBadgeClass(task.priority),
                    )}
                  >
                    {TASK_PRIORITY_LABELS[task.priority]}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                      taskDueBadgeClass(dueStatus),
                    )}
                  >
                    {TASK_DUE_STATUS_LABELS[dueStatus]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {/* AC 9 makes assignedTo non-nullable; null is unreachable
                      in normal flow and would indicate a data integrity issue. */}
                  {task.assignee
                    ? `Assigned to ${task.assignee.firstName} ${task.assignee.lastName}`
                    : 'Unassigned'}
                  {task.dueDate ? ` · Due ${formatDueDate(task.dueDate)}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canUpdate && !isClosed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1.5"
                  onClick={handleComplete}
                  disabled={completing}
                >
                  <Check className="h-3.5 w-3.5" />
                  {completing ? 'Completing...' : 'Complete'}
                </Button>
              ) : null}
              {canAssign ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1.5"
                  onClick={() => setAssignOpen(true)}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Assign
                </Button>
              ) : null}
              {canUpdate ? (
                <Button
                  variant="default"
                  size="sm"
                  className="h-11 gap-1.5"
                  onClick={() => router.push(`/tasks/${task.id}/edit`)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-11 gap-1.5"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Task Details
            </h3>
            <div className="space-y-3">
              <DetailRow label="Description">
                {task.description ? (
                  <span className="text-slate-700">{task.description}</span>
                ) : (
                  <span className="italic text-slate-300">&mdash;</span>
                )}
              </DetailRow>
              <DetailRow label="Due date">
                {task.dueDate ? (
                  <span className="text-slate-700">{formatDueDate(task.dueDate)}</span>
                ) : (
                  <span className="italic text-slate-300">&mdash;</span>
                )}
              </DetailRow>
              {task.completedAt ? (
                <DetailRow label="Completed at">
                  <span className="text-slate-700">{formatDueDate(task.completedAt)}</span>
                </DetailRow>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Related records
            </h3>
            <div className="space-y-3">
              <DetailRow label="Contact">
                {task.contact ? (
                  <Link
                    href={`/contacts/${task.contact.id}`}
                    className="text-indigo-600 hover:underline"
                  >
                    {task.contact.firstName} {task.contact.lastName}
                  </Link>
                ) : (
                  <span className="italic text-slate-300">&mdash;</span>
                )}
              </DetailRow>
              <DetailRow label="Deal">
                {task.deal ? (
                  <Link href={`/deals/${task.deal.id}`} className="text-indigo-600 hover:underline">
                    {task.deal.title}
                  </Link>
                ) : (
                  <span className="italic text-slate-300">&mdash;</span>
                )}
              </DetailRow>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Metadata
            </h3>
            <div className="space-y-3">
              <MetaItem label="Created by" value={task.createdBy} />
              <MetaItem label="Created" value={formatDueDate(task.createdAt)} />
              <MetaItem label="Last updated" value={formatDueDate(task.updatedAt)} />
            </div>
          </div>
        </div>
      </Card>

      <AssigneePickerDialog
        task={task}
        open={assignOpen}
        onOpenChange={(open) => setAssignOpen(open)}
      />
    </div>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <span className="text-sm text-slate-700">{value}</span>
    </div>
  )
}
