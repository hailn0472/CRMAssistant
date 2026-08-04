'use client'

import { Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

import { TaskForm } from '@/components/tasks/TaskForm'
import type { Task } from '@/services/task.service'

type TaskFormDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present → editing this task. Absent → creating a new one. */
  task?: Task
  /** Pre-selects the "from template" flow — mirrors the ?fromTemplate=1 route param. */
  fromTemplate?: boolean
  /** Pre-selects a contact — mirrors the ?contactId= route param. */
  initialContactId?: string
  onSaved?: (task: Task) => void
}

export function TaskFormDrawer({
  open,
  onOpenChange,
  task,
  fromTemplate,
  initialContactId,
  onSaved,
}: TaskFormDrawerProps): React.JSX.Element | null {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  if (!open || !mounted) return null

  function handleSaved(savedTask: Task): void {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    void queryClient.invalidateQueries({ queryKey: ['tasks-stats'] })
    if (task) {
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    }
    onOpenChange(false)
    if (onSaved) {
      onSaved(savedTask)
      return
    }
    if (task) {
      router.refresh()
    } else {
      router.push(`/tasks/${savedTask.id}`)
    }
  }

  const title = task ? 'Edit task' : 'New task'
  const subtitle = task ? task.title : 'Create, assign and track a task across your team.'

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-[#18181c]/32 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-[540px] max-w-full flex-col border-l border-[#e6e6eb] bg-white shadow-[-24px_0_60px_rgba(20,20,26,0.12)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#f0f0f4] px-6 pb-[18px] pt-[22px]">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#1b1b1f]">{title}</h2>
            <p className="truncate text-[12.5px] text-[#8c8c96]">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close panel"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] border border-[#e6e6eb] bg-white text-[15px] leading-none text-[#6b6b76] transition-colors hover:bg-[#f4f4f6]"
          >
            ×
          </button>
        </div>

        <Suspense>
          <TaskForm
            task={task}
            fromTemplate={fromTemplate}
            initialContactId={initialContactId}
            onSaved={handleSaved}
            onCancel={() => onOpenChange(false)}
          />
        </Suspense>
      </div>
    </div>,
    document.body,
  )
}
