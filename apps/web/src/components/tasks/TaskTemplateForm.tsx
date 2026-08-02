'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { createTaskTemplate, updateTaskTemplate } from '@/services/task.service'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from '@/lib/task-format'
import type { TaskTemplate } from '@/services/task.service'

const taskTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  title: z.string().trim().min(1, 'Task title is required'),
  description: z.string().optional(),
  defaultPriority: z.enum(TASK_PRIORITIES),
  defaultDueInDays: z.preprocess(
    (val) => (val === '' ? undefined : Number(val)),
    z.number().int().min(0).max(365).optional(),
  ),
})

type TaskTemplateFormValues = z.infer<typeof taskTemplateSchema>

type TaskTemplateFormProps = {
  template?: TaskTemplate | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskTemplateForm({
  template,
  open,
  onOpenChange,
}: TaskTemplateFormProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const isEditing = Boolean(template)

  const createMutation = useMutation({
    mutationFn: (input: TaskTemplateFormValues) => createTaskTemplate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskTemplates'] })
      handleClose()
      toast.success('Task template created')
    },
    onError: (error) => {
      setError('root', {
        message: error instanceof Error ? error.message : 'Failed to create template',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<TaskTemplateFormValues> }) =>
      updateTaskTemplate(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskTemplates'] })
      handleClose()
      toast.success('Task template updated')
    },
    onError: (error) => {
      setError('root', {
        message: error instanceof Error ? error.message : 'Failed to update template',
      })
    },
  })

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TaskTemplateFormValues>({
    resolver: zodResolver(taskTemplateSchema) as any,
    defaultValues: {
      name: template?.name ?? '',
      title: template?.title ?? '',
      description: template?.description ?? '',
      defaultPriority: template?.defaultPriority ?? 'MEDIUM',
      defaultDueInDays: template?.defaultDueInDays ?? undefined,
    },
  })

  // Local handleClose resets the form before closing — passing the parent
  // callback straight through lets an ESC/overlay close skip the reset and
  // leak the previous values into the next open (Story 3.5 findings I1/I2;
  // CompetitorForm.tsx:99 is the correct shape).
  const handleClose = (): void => {
    reset()
    onOpenChange(false)
  }

  const onSubmit = async (values: TaskTemplateFormValues): Promise<void> => {
    const input = {
      ...values,
      description: values.description?.trim() || undefined,
      defaultDueInDays: values.defaultDueInDays ?? undefined,
    }
    if (isEditing && template) {
      updateMutation.mutate({ id: template.id, input })
    } else {
      createMutation.mutate(input)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit task template' : 'Add task template'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Name</label>
            <Input {...register('name')} aria-invalid={Boolean(errors.name)} />
            {errors.name && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.name.message}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Task title</label>
            <Input {...register('title')} aria-invalid={Boolean(errors.title)} />
            {errors.title && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.title.message}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <Input {...register('description')} />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Default priority</label>
            <select
              {...register('defaultPriority')}
              className="flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {TASK_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Due in (days, 0–365)</label>
            <Input
              type="number"
              min={0}
              max={365}
              placeholder="Leave empty for no due date"
              {...register('defaultDueInDays')}
              aria-invalid={Boolean(errors.defaultDueInDays)}
            />
            {errors.defaultDueInDays && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.defaultDueInDays.message}
              </span>
            )}
          </div>

          {errors.root?.message && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {errors.root.message}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
