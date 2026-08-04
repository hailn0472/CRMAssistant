'use client'

import Link from 'next/link'
import { Suspense } from 'react'

import { TaskForm } from '@/components/tasks/TaskForm'
import type { Task } from '@/services/task.service'

type TaskFormPanelProps = {
  task?: Task
}

/// Route-level presentation of TaskForm (/tasks/new, /tasks/[id]/edit).
/// The tasks list opens the same form as a slide-over instead. Wrapped in
/// Suspense because TaskForm reads ?fromTemplate=1 via useSearchParams.
export function TaskFormPanel({ task }: TaskFormPanelProps): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
          {task ? 'Edit task' : 'New task'}
        </h1>
        <p className="text-[13.5px] text-[#77777f]">
          {task
            ? `Update details for "${task.title}".`
            : 'Create, assign and track a task across your team.'}
        </p>
      </div>

      <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
        <Suspense>
          <TaskForm task={task} />
        </Suspense>
      </div>

      <Link
        href={task ? `/tasks/${task.id}` : '/tasks'}
        className="inline-flex text-[13px] text-[#77777f] transition-colors hover:text-[#1b1b1f]"
      >
        ← Back to {task ? 'task' : 'tasks'}
      </Link>
    </div>
  )
}
