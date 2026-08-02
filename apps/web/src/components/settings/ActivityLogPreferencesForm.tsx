'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, FormSkeleton } from '@/components/shared'
import { cn } from '@/lib/utils'
import {
  getMyActivityLogPreferences,
  updateActivityLogPreferences,
  type ActivityLogPreference,
} from '@/services/activity.service'

const activityLogPreferencesSchema = z.object({
  logTaskCompleted: z.boolean(),
  logDealCreated: z.boolean(),
  logDealStageChanged: z.boolean(),
  logMessageSent: z.boolean(),
  logMessageReceived: z.boolean(),
  logMeetingScheduled: z.boolean(),
})

type ActivityLogPreferencesValues = z.infer<typeof activityLogPreferencesSchema>

const TOGGLE_FIELDS: Array<{
  key: keyof ActivityLogPreferencesValues
  label: string
  description: string
  ariaLabel: string
}> = [
  {
    key: 'logTaskCompleted',
    label: 'Task completed',
    description: 'Log a "Task Completed" event on the contact timeline when a task is completed.',
    ariaLabel: 'Log task completions',
  },
  {
    key: 'logDealCreated',
    label: 'Deal created',
    description: 'Log a "Deal Created" event on the contact timeline when a deal is created.',
    ariaLabel: 'Log deal creation',
  },
  {
    key: 'logDealStageChanged',
    label: 'Deal stage changed',
    description: 'Log a "Stage Changed" event when a deal moves between pipeline stages.',
    ariaLabel: 'Log deal stage changes',
  },
  {
    key: 'logMessageSent',
    label: 'Message sent',
    description: 'Log a "Message Sent" event when an agent sends a customer message.',
    ariaLabel: 'Log sent messages',
  },
  {
    key: 'logMessageReceived',
    label: 'Message received',
    description: 'Log a "Message Received" event when a customer message arrives.',
    ariaLabel: 'Log received messages',
  },
  {
    key: 'logMeetingScheduled',
    label: 'Meeting scheduled',
    description:
      'Log a "Meeting Scheduled" event when a task with a due date is pushed to a calendar.',
    ariaLabel: 'Log scheduled meetings',
  },
]

export function ActivityLogPreferencesForm(): React.JSX.Element {
  const queryClient = useQueryClient()
  const {
    data: prefs,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['myActivityLogPreferences'],
    queryFn: getMyActivityLogPreferences,
  })

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ActivityLogPreferencesValues>({
    resolver: zodResolver(activityLogPreferencesSchema) as never,
    values: (prefs ?? {
      logTaskCompleted: true,
      logDealCreated: true,
      logDealStageChanged: true,
      logMessageSent: true,
      logMessageReceived: true,
      logMeetingScheduled: true,
    }) as ActivityLogPreferencesValues,
  })

  const mutation = useMutation({
    mutationFn: (input: ActivityLogPreferencesValues) => updateActivityLogPreferences(input),
    onSuccess: (updated: ActivityLogPreference) => {
      queryClient.invalidateQueries({ queryKey: ['myActivityLogPreferences'] })
      const disabledCount = Object.values(updated).filter((v) => !v).length
      // Success copy states impact, not just "Saved" (UX Feedback Patterns).
      toast.success(
        disabledCount === 0
          ? 'All activity logging enabled — every channel event will appear on contact timelines.'
          : `${disabledCount} of 6 logging rules turned off — those events will no longer appear on contact timelines.`,
      )
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update preferences')
    },
  })

  const onSubmit = (values: ActivityLogPreferencesValues): void => {
    mutation.mutate(values)
  }

  if (isLoading) {
    return <FormSkeleton />
  }

  if (isError) {
    return (
      <ErrorState
        title="Could not load activity logging preferences"
        message="Your preferences could not be loaded. Please try again."
        onRetry={() => {
          void refetch()
        }}
      />
    )
  }

  return (
    <Card className="max-w-[560px] border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-slate-950">Activity Logging Preferences</CardTitle>
        <CardDescription>
          Choose which automatic events appear on contact timelines. Auto-logged events are marked
          with an &quot;Auto&quot; badge.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="space-y-4">
            {TOGGLE_FIELDS.map((toggle) => (
              <Controller
                key={toggle.key}
                control={control}
                name={toggle.key}
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{toggle.label}</p>
                      <p className="text-xs text-slate-500">{toggle.description}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={field.value}
                      aria-label={toggle.ariaLabel}
                      onClick={() => field.onChange(!field.value)}
                      className={cn(
                        'relative inline-flex w-[44px] h-[24px] shrink-0 rounded-full transition-colors',
                        field.value ? 'bg-indigo-600' : 'bg-slate-300',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-[2px] h-5 w-5 rounded-full bg-white shadow transition-transform',
                          field.value ? 'translate-x-[20px]' : 'translate-x-[2px]',
                        )}
                      />
                    </button>
                  </div>
                )}
              />
            ))}
          </div>

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit" disabled={isSubmitting} className="h-11">
              {isSubmitting ? 'Saving...' : 'Save preferences'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
