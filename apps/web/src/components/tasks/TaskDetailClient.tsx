'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { deleteTask, completeTask, getTaskDependencies } from '@/services/task.service'
import { usePermission } from '@/hooks/usePermission'
import { AssigneePickerDialog } from './AssigneePickerDialog'
import { TaskCalendarSyncBadge } from './TaskCalendarSyncBadge'
import { TaskFormDrawer } from './TaskFormDrawer'
import { TaskTimerWidget } from './TaskTimerWidget'
import { TimeEntryList } from './TimeEntryList'
import { TaskDependenciesSection } from './TaskDependenciesSection'
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_DOT_COLOR,
  TASK_STATUS_LABELS,
  TASK_RECURRENCE_PATTERN_LABELS,
  formatDueDate,
} from '@/lib/task-format'
import { cn } from '@/lib/utils'
import type { Task } from '@/services/task.service'

type TaskDetailClientProps = {
  task: Task
}

const PRIORITY_BADGE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  LOW: { color: '#4b4b55', bg: '#f4f4f6', border: '#ececf0' },
  MEDIUM: { color: '#2563eb', bg: '#eff6ff', border: '#dbeafe' },
  HIGH: { color: '#c2860a', bg: '#fdf6e7', border: '#f0e2c0' },
  URGENT: { color: '#b91c1c', bg: '#fdf2f2', border: '#f0d5d5' },
}

function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

function getOverdueDays(dueDateStr?: string | null): number | null {
  if (!dueDateStr) return null
  const due = new Date(dueDateStr)
  const now = new Date()
  due.setHours(0, 0, 0, 0)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffTime = today.getTime() - due.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  return diffDays > 0 ? diffDays : null
}

/**
 * Derived from the task record itself — every entry is a real timestamp we
 * already hold. There is no task-scoped activity API (contactTimeline is
 * contact-scoped), so nothing here is invented.
 */
function buildActivity(task: Task): Array<{ dot: string; title: string; meta: string }> {
  const entries: Array<{ dot: string; title: string; meta: string }> = [
    { dot: '#8c8c96', title: 'Task created', meta: formatDueDate(task.createdAt) },
  ]
  if (task.assignee) {
    entries.push({
      dot: '#4f46e5',
      title: `Assigned to ${task.assignee.firstName} ${task.assignee.lastName}`,
      meta: task.assignee.email,
    })
  }
  if (task.completedAt) {
    entries.push({
      dot: '#22a06b',
      title: 'Task completed',
      meta: formatDueDate(task.completedAt),
    })
  }
  return entries
}

export function TaskDetailClient({ task }: TaskDetailClientProps): React.JSX.Element {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // Story 4.6 (AC 62-63): fetch dependency view to determine blocked state
  const { data: depView } = useQuery({
    queryKey: ['taskDependencies', task.id],
    queryFn: () => getTaskDependencies(task.id),
  })

  const isBlocked = depView?.isBlocked ?? false
  const openBlockerNames = depView?.blockedBy
    ?.filter((n) => n.status !== 'COMPLETED')
    .map((n) => n.title)
    .filter(Boolean) as string[] | undefined

  const canUpdate = usePermission('TASK', 'UPDATE')
  const canAssign = usePermission('TASK', 'ASSIGN')
  const canDelete = usePermission('TASK', 'DELETE')

  const isClosed = task.status === 'COMPLETED' || task.status === 'CANCELLED'
  const isDone = task.status === 'COMPLETED'
  const overdueDays = !isClosed ? getOverdueDays(task.dueDate) : null
  const activity = buildActivity(task)
  const priorityStyle = PRIORITY_BADGE_STYLE[task.priority] ?? PRIORITY_BADGE_STYLE['LOW']

  const handleComplete = async (): Promise<void> => {
    setCompleting(true)
    try {
      await completeTask(task.id)
      toast.success('Task completed and removed from your open list')
      router.refresh()
    } catch (error) {
      // Story 4.6 (AC 61): surface the server error message
      toast.error(error instanceof Error ? error.message : 'Failed to complete task')
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
    <div className="mx-auto w-full max-w-[1180px] px-7 pb-12 pt-[26px]">
      <Link
        href="/tasks"
        className="mb-4 inline-flex items-center gap-[7px] text-[12.5px] text-[#8c8c96] transition-colors hover:text-[#1b1b1f] hover:no-underline"
      >
        ← Back to tasks
      </Link>

      <div className="mb-[22px] flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 items-start gap-[13px]">
          {canUpdate && !isClosed ? (
            <button
              type="button"
              onClick={handleComplete}
              disabled={completing || isBlocked}
              aria-label="Mark task complete"
              aria-describedby={isBlocked ? 'blocked-reason' : undefined}
              title={
                isBlocked ? 'Cannot complete — task has open dependencies' : 'Mark task complete'
              }
              className="mt-[5px] flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] border-[1.5px] border-[#d8d8e0] bg-white text-white text-[12px] transition-colors hover:border-[#1b1b1f] disabled:opacity-50"
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'mt-[5px] flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] border-[1.5px] text-[12px]',
                isDone
                  ? 'border-[#22a06b] bg-[#22a06b] text-white'
                  : 'border-[#d8d8e0] bg-white text-[#c7c7d1]',
              )}
            >
              {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
            </span>
          )}

          <div className="flex min-w-0 flex-col gap-2">
            <h1
              className={cn(
                'm-0 text-[23px] font-semibold tracking-[-0.025em]',
                isDone ? 'text-[#8c8c96] line-through' : 'text-[#1b1b1f]',
              )}
            >
              {task.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-[6px] rounded-full bg-[#f4f4f6] py-[3px] pl-2 pr-2.5 text-[11.5px] font-medium text-[#4b4b55]">
                <span
                  className="block h-[5px] w-[5px] rounded-full"
                  style={{ background: TASK_STATUS_DOT_COLOR[task.status] }}
                />
                {TASK_STATUS_LABELS[task.status]}
              </span>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
                style={{
                  color: priorityStyle.color,
                  backgroundColor: priorityStyle.bg,
                  border: `1px solid ${priorityStyle.border}`,
                }}
              >
                {TASK_PRIORITY_LABELS[task.priority]} priority
              </span>
              {overdueDays !== null ? (
                <span className="inline-flex items-center rounded-full border border-[#f0d5d5] bg-[#fdf2f2] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#b91c1c]">
                  Overdue by {overdueDays} {overdueDays === 1 ? 'day' : 'days'}
                </span>
              ) : null}
              {/* Story 4.6 (AC 62-63): blocked badge */}
              {isBlocked && !isClosed ? (
                <span className="inline-flex items-center rounded-full border border-[#f0e2c0] bg-[#fdf6e7] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#92640d]">
                  Blocked
                </span>
              ) : null}
              <span className="text-[12.5px] text-[#8c8c96]">
                {task.dueDate ? `Due ${formatDueDate(task.dueDate)}` : 'No due date'}
                {task.assignee
                  ? ` · ${task.assignee.firstName} ${task.assignee.lastName}`
                  : ' · Unassigned'}
              </span>
            </div>
            {/* Story 4.6 (AC 62-63): inline blocked reason */}
            {isBlocked && !isClosed ? (
              <p id="blocked-reason" className="m-0 text-[12px] text-[#92640d]">
                Complete disabled — blocked by:{' '}
                {openBlockerNames && openBlockerNames.length > 0
                  ? openBlockerNames.join(', ')
                  : 'open dependencies'}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-none items-center gap-2">
          {canAssign ? (
            <button
              type="button"
              onClick={() => setAssignOpen(true)}
              aria-label="Assign task"
              className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#f0f0f3] text-[9px] font-semibold text-[#4b4b55]">
                {task.assignee ? initials(task.assignee.firstName, task.assignee.lastName) : '?'}
              </span>
              {task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : 'Assign'}
              <span className="text-[9px] text-[#b4b4bd]">▾</span>
            </button>
          ) : null}
          {canUpdate ? (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex h-9 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black"
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-[9px] rounded-[14px] border border-[#ececf0] bg-white px-5 py-[18px]">
            <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Description</h2>
            {task.description ? (
              <p className="m-0 text-[13.5px] leading-[1.6] text-[#4b4b55]">{task.description}</p>
            ) : (
              <p className="m-0 text-[13.5px] text-[#a0a0aa]">&mdash;</p>
            )}
          </section>

          {/* Story 4.6 (AC 52): Dependencies section between Description and Time entries */}
          <TaskDependenciesSection taskId={task.id} />

          {/* Story 4.5 (AC 38): the entries list sits between Description and Activity. */}
          <TimeEntryList taskId={task.id} />

          <section className="flex flex-col gap-3.5 rounded-[14px] border border-[#ececf0] bg-white px-5 py-[18px]">
            <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Activity</h2>
            {activity.map((entry) => (
              <div key={entry.title} className="flex gap-3">
                <span
                  className="mt-[5px] block h-2 w-2 flex-none rounded-full"
                  style={{ background: entry.dot }}
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-[#1b1b1f]">{entry.title}</span>
                  <span className="text-[12px] text-[#8c8c96]">{entry.meta}</span>
                </div>
              </div>
            ))}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {/* Story 4.5 (AC 34): the timer widget is the FIRST section in the
              aside — immediately before the Details card. */}
          <TaskTimerWidget taskId={task.id} />

          <section className="flex flex-col gap-3 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
            <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Details</h2>
            <DetailRow label="Status">{TASK_STATUS_LABELS[task.status]}</DetailRow>
            <DetailRow label="Priority">{TASK_PRIORITY_LABELS[task.priority]}</DetailRow>
            <DetailRow label="Assignee">
              {task.assignee
                ? `${task.assignee.firstName} ${task.assignee.lastName}`
                : 'Unassigned'}
            </DetailRow>
            <DetailRow label="Due date">
              {task.dueDate ? formatDueDate(task.dueDate) : <Dash />}
            </DetailRow>
            {task.completedAt ? (
              <DetailRow label="Completed at">{formatDueDate(task.completedAt)}</DetailRow>
            ) : null}
            {/* Story 4.6 (AC 68): recurrence info */}
            {task.isRecurring && task.recurrencePattern ? (
              <DetailRow label="Repeats">
                {TASK_RECURRENCE_PATTERN_LABELS[
                  task.recurrencePattern as keyof typeof TASK_RECURRENCE_PATTERN_LABELS
                ] ?? task.recurrencePattern}
                {task.recurrenceEndDate ? ` until ${formatDueDate(task.recurrenceEndDate)}` : ''}
                <span className="block text-[11px] font-normal text-[#8c8c96]">All times UTC</span>
              </DetailRow>
            ) : null}
            {task.parentTaskId ? (
              <DetailRow label="Parent task">
                <a
                  href={`/tasks/${task.parentTaskId}`}
                  className="text-[13px] text-[#4338ca] hover:underline"
                >
                  View parent
                </a>
              </DetailRow>
            ) : null}
          </section>

          <section className="flex flex-col gap-3 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
            <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Related</h2>
            {task.contact ? (
              <RelatedRow
                initials={initials(task.contact.firstName, task.contact.lastName)}
                href={`/contacts/${task.contact.id}`}
                name={`${task.contact.firstName} ${task.contact.lastName}`}
                caption="Contact"
              />
            ) : (
              <EmptyRelated label="No contact linked" />
            )}
            {task.deal ? (
              <RelatedRow
                initials={task.deal.title.slice(0, 2).toUpperCase()}
                href={`/deals/${task.deal.id}`}
                name={task.deal.title}
                caption="Deal"
              />
            ) : (
              <EmptyRelated label="No deal linked" actionLink="#" actionText="Link a deal" />
            )}
          </section>

          <section className="flex flex-col gap-[10px] rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Calendar</h2>
                <TaskCalendarSyncBadge taskId={task.id} />
              </div>
            </div>

            <div className="mt-1 flex flex-col gap-2 border-t border-[#f2f2f5] pt-2.5">
              <MetaRow label="Created" value={formatDueDate(task.createdAt)} />
              <MetaRow label="Last updated" value={formatDueDate(task.updatedAt)} />
              {canDelete ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="mt-1 inline-flex h-8 items-center self-start rounded-[8px] border border-[#e6e6eb] bg-white px-3 text-[12.5px] font-medium text-[#b91c1c] transition-colors hover:border-[#f0d5d5] hover:bg-[#fdf2f2] disabled:opacity-60"
                >
                  {deleting ? 'Deleting...' : 'Delete task'}
                </button>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      <AssigneePickerDialog
        task={task}
        open={assignOpen}
        onOpenChange={(open) => setAssignOpen(open)}
      />

      <TaskFormDrawer open={editOpen} onOpenChange={setEditOpen} task={task} />
    </div>
  )
}

function Dash(): React.JSX.Element {
  return <span className="text-[#a0a0aa]">&mdash;</span>
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3.5 text-[13px]">
      <span className="flex-none text-[#8c8c96]">{label}</span>
      <span className="truncate text-right font-medium text-[#1b1b1f]">{children}</span>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3.5 text-[12.5px]">
      <span className="text-[#8c8c96]">{label}</span>
      <span className="font-mono text-[#1b1b1f]">{value}</span>
    </div>
  )
}

function RelatedRow({
  initials: init,
  href,
  name,
  caption,
}: {
  initials: string
  href: string
  name: string
  caption: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[11px]">
      <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-[#f0f0f3] text-[10.5px] font-semibold text-[#4b4b55]">
        {init}
      </span>
      <div className="flex min-w-0 flex-col gap-px">
        <Link
          href={href}
          className="truncate text-[13px] font-medium text-[#1b1b1f] hover:underline"
        >
          {name}
        </Link>
        <span className="text-[11.5px] text-[#a0a0aa]">{caption}</span>
      </div>
    </div>
  )
}

function EmptyRelated({
  label,
  actionLink,
  actionText,
}: {
  label: string
  actionLink?: string
  actionText?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[11px]">
      <span className="block h-[30px] w-[30px] flex-none rounded-[8px] border border-dashed border-[#d8d8e0]" />
      <div className="flex min-w-0 flex-col gap-px">
        <span className="text-[13px] font-medium text-[#8c8c96]">{label}</span>
        {actionLink && actionText ? (
          <Link href={actionLink} className="text-[11.5px] text-[#4338ca] hover:underline">
            {actionText}
          </Link>
        ) : (
          <span className="text-[11.5px] text-[#a0a0aa]">&mdash;</span>
        )}
      </div>
    </div>
  )
}
