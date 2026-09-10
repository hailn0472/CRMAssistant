'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { TasksTable } from '@/components/tasks/TasksTable'
import { TaskMetricsCards } from '@/components/tasks/TaskMetricsCards'
import { TaskFormDrawer } from '@/components/tasks/TaskFormDrawer'
import { usePermission } from '@/hooks/usePermission'

export function TasksWorkspace(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)
  const [createFromTemplate, setCreateFromTemplate] = useState(false)

  const canCreate = usePermission('TASK', 'CREATE')

  function openCreate(fromTemplate: boolean): void {
    setCreateFromTemplate(fromTemplate)
    setCreateOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">Tasks</h1>
          <p className="text-[13.5px] text-[#77777f]">
            Create, assign and track work across your team.
          </p>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openCreate(true)}
              className="inline-flex h-9 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
            >
              New from template
            </button>
            <button
              type="button"
              onClick={() => openCreate(false)}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black"
            >
              <Plus className="h-3.5 w-3.5" />
              Create task
            </button>
          </div>
        ) : null}
      </div>

      <TaskMetricsCards />

      <TasksTable />

      <TaskFormDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        fromTemplate={createFromTemplate}
      />
    </div>
  )
}
