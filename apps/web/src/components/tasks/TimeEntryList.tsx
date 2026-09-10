'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  createTimeEntry,
  deleteTimeEntry,
  getTimeEntries,
  updateTimeEntry,
} from '@/services/time-entry.service'
import type { TimeEntry, TimeEntryConnection } from '@/services/time-entry.service'
import { usePermission } from '@/hooks/usePermission'
import { formatDurationShort } from '@/lib/time-format'

// Story 4.5 task-detail time entries (AC 38). Add/edit/delete via the
// project's custom context-based Dialog (NOT Radix), React Hook Form + Zod v4
// with zodResolver(schema) as any (the sanctioned workaround), and the house
// optimistic recipe: onMutate cancels + snapshots the affected query keys,
// onError restores the snapshot and raises a react-hot-toast error,
// onSettled invalidates.

const MAX_DURATION_MINUTES = 1440 // 24h cap — mirrors the API's 86400s bound

const timeEntrySchema = z.object({
  durationMinutes: z.coerce
    .number()
    .int('Duration must be a whole number')
    .min(1, 'Duration must be at least 1 minute')
    .max(MAX_DURATION_MINUTES, 'Duration must not exceed 24 hours'),
  date: z.string().min(1, 'Date is required'),
  description: z.string().max(500, 'Description must not exceed 500 characters'),
})

type TimeEntryFormValues = z.infer<typeof timeEntrySchema>

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function TimeEntryList({ taskId }: { taskId: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const canUpdate = usePermission('TASK', 'UPDATE')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TimeEntry | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['timeEntries', { taskId }],
    queryFn: () => getTimeEntries({ taskId }, { pageSize: 100 }),
  })

  const entries = data?.items ?? []

  function snapshotTimeEntries(): ReturnType<QueryClient['getQueriesData']> {
    return queryClient.getQueriesData({ queryKey: ['timeEntries'] })
  }

  function restoreTimeEntries(snapshot: ReturnType<QueryClient['getQueriesData']>): void {
    for (const [key, queryData] of snapshot) {
      queryClient.setQueryData(key, queryData)
    }
  }

  const createMutation = useMutation({
    mutationFn: (input: {
      durationSeconds: number
      startTime: string
      description: string | null
    }) => createTimeEntry({ taskId, ...input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['timeEntries'] })
      const snapshot = snapshotTimeEntries()
      const optimistic: TimeEntry = {
        id: `temp-${Date.now()}`,
        taskId,
        userId: '',
        startTime: input.startTime,
        endTime: new Date(
          new Date(input.startTime).getTime() + input.durationSeconds * 1000,
        ).toISOString(),
        durationSeconds: input.durationSeconds,
        description: input.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        task: { id: taskId, title: '' },
      }
      queryClient.setQueriesData<TimeEntryConnection>({ queryKey: ['timeEntries'] }, (old) =>
        old ? { ...old, items: [optimistic, ...old.items], total: old.total + 1 } : old,
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => {
      if (context?.snapshot) restoreTimeEntries(context.snapshot)
      toast.error('Failed to add time entry')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['timeEntries'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (vars: {
      id: string
      durationSeconds: number
      startTime: string
      description: string | null
    }) =>
      updateTimeEntry(vars.id, {
        durationSeconds: vars.durationSeconds,
        startTime: vars.startTime,
        description: vars.description,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['timeEntries'] })
      const snapshot = snapshotTimeEntries()
      queryClient.setQueriesData<TimeEntryConnection>({ queryKey: ['timeEntries'] }, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((entry) =>
                entry.id === vars.id
                  ? {
                      ...entry,
                      durationSeconds: vars.durationSeconds,
                      startTime: vars.startTime,
                      description: vars.description,
                    }
                  : entry,
              ),
            }
          : old,
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => {
      if (context?.snapshot) restoreTimeEntries(context.snapshot)
      toast.error('Failed to update time entry')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['timeEntries'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTimeEntry(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['timeEntries'] })
      const snapshot = snapshotTimeEntries()
      queryClient.setQueriesData<TimeEntryConnection>({ queryKey: ['timeEntries'] }, (old) =>
        old
          ? { ...old, items: old.items.filter((entry) => entry.id !== id), total: old.total - 1 }
          : old,
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => {
      if (context?.snapshot) restoreTimeEntries(context.snapshot)
      toast.error('Failed to delete time entry')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['timeEntries'] })
    },
  })

  function openAdd(): void {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(entry: TimeEntry): void {
    setEditing(entry)
    setDialogOpen(true)
  }

  function handleDelete(entry: TimeEntry): void {
    if (!confirm('Delete this time entry?')) return
    deleteMutation.mutate(entry.id)
  }

  return (
    <section className="flex flex-col gap-3.5 rounded-[14px] border border-[#ececf0] bg-white px-5 py-[18px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Time entries</h2>
        {canUpdate ? (
          <Button type="button" size="sm" variant="outline" onClick={openAdd} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add time
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="m-0 text-[13px] text-[#8c8c96]">Loading entries…</p>
      ) : entries.length === 0 ? (
        <p className="m-0 text-[13px] text-[#a0a0aa]">
          No time entries on this task{canUpdate ? ' — start the timer or add time manually' : ''}.
        </p>
      ) : (
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 border-t border-[#f2f2f5] py-2.5 first:border-t-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12.5px] font-medium text-[#1b1b1f]">
                  {toDateInput(new Date(entry.startTime))}
                </span>
                {entry.description ? (
                  <span className="truncate text-[12px] text-[#8c8c96]">{entry.description}</span>
                ) : null}
              </div>
              <div className="flex flex-none items-center gap-1.5">
                <span className="font-mono text-[12.5px] text-[#4b4b55]">
                  {formatDurationShort(entry.durationSeconds)}
                </span>
                {canUpdate ? (
                  <>
                    <button
                      type="button"
                      aria-label={`Edit time entry ${entry.id}`}
                      onClick={() => openEdit(entry)}
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#8c8c96] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete time entry ${entry.id}`}
                      onClick={() => handleDelete(entry)}
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#8c8c96] transition-colors hover:bg-[#fdf2f2] hover:text-[#b91c1c]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit time entry' : 'Add time'}</DialogTitle>
          </DialogHeader>
          <TimeEntryForm
            entry={editing}
            submitting={createMutation.isPending || updateMutation.isPending}
            onSubmit={(values) => {
              const payload = {
                durationSeconds: values.durationMinutes * 60,
                startTime: `${values.date}T00:00:00.000Z`,
                description: values.description.trim() || null,
              }
              if (editing) {
                updateMutation.mutate({ id: editing.id, ...payload })
              } else {
                createMutation.mutate(payload)
              }
              setDialogOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TimeEntryForm({
  entry,
  submitting,
  onSubmit,
}: {
  entry: TimeEntry | null
  submitting: boolean
  onSubmit: (values: TimeEntryFormValues) => void
}): React.JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TimeEntryFormValues>({
    resolver: zodResolver(timeEntrySchema) as any,
    defaultValues: {
      durationMinutes: entry ? Math.max(1, Math.round(entry.durationSeconds / 60)) : 30,
      date: entry ? toDateInput(new Date(entry.startTime)) : toDateInput(new Date()),
      description: entry?.description ?? '',
    },
  })

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values))}
      noValidate
      className="flex flex-col gap-3.5"
      aria-label={entry ? 'Edit time entry form' : 'Add time entry form'}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="time-entry-duration" className="text-[11.5px] font-medium text-[#8c8c96]">
          Duration (minutes)
        </label>
        <Input
          id="time-entry-duration"
          type="number"
          min={1}
          max={MAX_DURATION_MINUTES}
          placeholder="30"
          {...register('durationMinutes')}
        />
        {errors.durationMinutes ? (
          <span role="alert" className="text-[11.5px] text-[#b91c1c]">
            {errors.durationMinutes.message}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="time-entry-date" className="text-[11.5px] font-medium text-[#8c8c96]">
          Date
        </label>
        <Input id="time-entry-date" type="date" {...register('date')} />
        {errors.date ? (
          <span role="alert" className="text-[11.5px] text-[#b91c1c]">
            {errors.date.message}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="time-entry-description"
          className="text-[11.5px] font-medium text-[#8c8c96]"
        >
          Description
        </label>
        <Textarea
          id="time-entry-description"
          rows={2}
          placeholder="What was this time spent on?"
          {...register('description')}
        />
        {errors.description ? (
          <span role="alert" className="text-[11.5px] text-[#b91c1c]">
            {errors.description.message}
          </span>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="submit" disabled={submitting} className="min-h-11">
          {entry ? 'Save changes' : 'Add entry'}
        </Button>
      </DialogFooter>
    </form>
  )
}
