'use client'

import React, { useEffect, useId } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  activityReportKeys,
  createActivityGoal,
  updateActivityGoal,
  type ActivityGoal,
  type ActivityGoalPeriod,
  type CreateActivityGoalInput,
} from '@/services/activity-report.service'
import type { ActivityTypeValue } from '@/types/activity.types'
import { ACTIVITY_TYPE_LABELS } from '@/types/activity.types'

const activityGoalFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
  activityType: z.string().optional().nullable(),
  targetCount: z
    .number()
    .int('Target must be an integer')
    .min(1, 'Target must be at least 1')
    .max(10000, 'Target must not exceed 10,000'),
  period: z.enum(['WEEKLY', 'MONTHLY']),
  userId: z.string().min(1, 'User is required'),
  startsOn: z.string().min(1, 'Start date is required'),
  isActive: z.boolean().default(true),
})

export type ActivityGoalFormValues = {
  name: string
  activityType?: string | null
  targetCount: number
  period: 'WEEKLY' | 'MONTHLY'
  userId: string
  startsOn: string
  isActive?: boolean
}

export interface ActivityGoalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  goal?: ActivityGoal | null
  users: Array<{ id: string; firstName: string; lastName: string }>
  currentUserId?: string
}

export function ActivityGoalDialog({
  open,
  onOpenChange,
  goal,
  users,
  currentUserId,
}: ActivityGoalDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const isEditMode = Boolean(goal)

  const nameId = useId()
  const typeId = useId()
  const targetId = useId()
  const periodId = useId()
  const userSelectId = useId()
  const startsOnId = useId()
  const activeId = useId()

  const defaultStartsOn = new Date().toISOString().split('T')[0]

  const form = useForm<ActivityGoalFormValues>({
    resolver: zodResolver(activityGoalFormSchema),
    defaultValues: {
      name: '',
      activityType: null,
      targetCount: 50,
      period: 'WEEKLY',
      userId: currentUserId || (users[0]?.id ?? ''),
      startsOn: defaultStartsOn,
      isActive: true,
    },
  })

  useEffect(() => {
    if (goal) {
      form.reset({
        name: goal.name,
        activityType: goal.activityType ?? null,
        targetCount: goal.targetCount,
        period: goal.period,
        userId: goal.userId,
        startsOn: goal.startsOn ? goal.startsOn.split('T')[0] : defaultStartsOn,
        isActive: goal.isActive,
      })
    } else {
      form.reset({
        name: '',
        activityType: null,
        targetCount: 50,
        period: 'WEEKLY',
        userId: currentUserId || (users[0]?.id ?? ''),
        startsOn: defaultStartsOn,
        isActive: true,
      })
    }
  }, [goal, form, currentUserId, users, defaultStartsOn])

  const createMutation = useMutation({
    mutationFn: (input: CreateActivityGoalInput) => createActivityGoal(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityReportKeys.all })
      toast.success('Activity goal created successfully')
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create activity goal')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: {
      id: string
      input: Partial<CreateActivityGoalInput> & { isActive?: boolean }
    }) => updateActivityGoal(data.id, data.input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityReportKeys.all })
      toast.success('Activity goal updated successfully')
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update activity goal')
    },
  })

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  const onSubmit = (values: ActivityGoalFormValues) => {
    if (isEditMode && goal) {
      updateMutation.mutate({
        id: goal.id,
        input: {
          name: values.name,
          activityType: values.activityType ? (values.activityType as ActivityTypeValue) : null,
          targetCount: values.targetCount,
          period: values.period as ActivityGoalPeriod,
          startsOn: new Date(values.startsOn).toISOString(),
          isActive: values.isActive,
        },
      })
    } else {
      createMutation.mutate({
        name: values.name,
        activityType: values.activityType ? (values.activityType as ActivityTypeValue) : null,
        targetCount: values.targetCount,
        period: values.period as ActivityGoalPeriod,
        userId: values.userId,
        startsOn: new Date(values.startsOn).toISOString(),
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white p-6 rounded-2xl shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-[#1b1b1f]">
            {isEditMode ? 'Edit Activity Goal' : 'Create Activity Goal'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="text-xs font-medium text-[#4b4b55]">
              Goal Name *
            </label>
            <Input
              id={nameId}
              {...form.register('name')}
              placeholder="e.g. 50 Calls per week"
              className="h-9"
            />
            {form.formState.errors.name && (
              <p className="text-xs text-red-500">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={typeId} className="text-xs font-medium text-[#4b4b55]">
                Activity Type
              </label>
              <select
                id={typeId}
                aria-label="Activity Type"
                {...form.register('activityType')}
                value={form.watch('activityType') ?? ''}
                onChange={(e) => form.setValue('activityType', e.target.value || null)}
                className="w-full h-9 rounded-md border border-[#e6e6eb] bg-white px-3 text-xs text-[#1b1b1f] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All Activities (Total)</option>
                {Object.entries(ACTIVITY_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={targetId} className="text-xs font-medium text-[#4b4b55]">
                Target Count *
              </label>
              <Input
                id={targetId}
                type="number"
                {...form.register('targetCount', { valueAsNumber: true })}
                className="h-9"
                min={1}
                max={10000}
              />
              {form.formState.errors.targetCount && (
                <p className="text-xs text-red-500">{form.formState.errors.targetCount.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={periodId} className="text-xs font-medium text-[#4b4b55]">
                Period *
              </label>
              <select
                id={periodId}
                aria-label="Period"
                {...form.register('period')}
                className="w-full h-9 rounded-md border border-[#e6e6eb] bg-white px-3 text-xs text-[#1b1b1f] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={userSelectId} className="text-xs font-medium text-[#4b4b55]">
                Assignee *
              </label>
              <select
                id={userSelectId}
                aria-label="Assignee"
                disabled={isEditMode}
                {...form.register('userId')}
                className="w-full h-9 rounded-md border border-[#e6e6eb] bg-white px-3 text-xs text-[#1b1b1f] focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-[#f4f4f6] disabled:text-[#8c8c96]"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={startsOnId} className="text-xs font-medium text-[#4b4b55]">
              Starts On (UTC) *
            </label>
            <Input id={startsOnId} type="date" {...form.register('startsOn')} className="h-9" />
          </div>

          {isEditMode && (
            <div className="flex items-center gap-2 pt-1">
              <input
                id={activeId}
                type="checkbox"
                {...form.register('isActive')}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor={activeId} className="text-xs font-medium text-[#1b1b1f]">
                Active goal
              </label>
            </div>
          )}

          <DialogFooter className="pt-3 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="min-h-[44px] text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[44px] bg-indigo-600 text-white hover:bg-indigo-700 text-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : isEditMode ? (
                'Update Goal'
              ) : (
                'Create Goal'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
