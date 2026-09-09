'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { ErrorState, FormSkeleton } from '@/components/shared'
import {
  getMyActivityLogPreferences,
  updateActivityLogPreferences,
  type ActivityLogPreference,
} from '@/services/activity.service'

const activityLogPreferencesSchema = z.object({
  logTaskCompleted: z.boolean(),
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
          : `${disabledCount} logging rules turned off — those events will no longer appear on contact timelines.`,
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
    <section className="max-w-[560px] rounded-[14px] border border-[#ececf0] bg-white px-[22px] py-5">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[18px]">
        <div className="flex flex-col">
          {TOGGLE_FIELDS.map((toggle) => (
            <Controller
              key={toggle.key}
              control={control}
              name={toggle.key}
              render={({ field }) => (
                <div className="flex items-center gap-5 border-b border-[#f4f4f7] py-3.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13.5px] font-medium text-[#1b1b1f]">{toggle.label}</span>
                    <span className="text-[12px] text-[#8c8c96]">{toggle.description}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={field.value}
                    aria-label={toggle.ariaLabel}
                    onClick={() => field.onChange(!field.value)}
                    className="ml-auto flex h-[24px] w-[44px] shrink-0 items-center rounded-full border p-[2px] transition-colors"
                    style={{
                      background: field.value ? '#1b1b1f' : '#ececf0',
                      borderColor: field.value ? '#1b1b1f' : '#e0e0e6',
                      justifyContent: field.value ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <span className="block h-[17px] w-[17px] rounded-full bg-white shadow-[0_1px_2px_rgba(20,20,26,0.2)]" />
                  </button>
                </div>
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-[12px] text-[#a0a0aa]">
            Auto-logged events carry an &quot;Auto&quot; badge on the timeline.
          </span>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-9 shrink-0 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {isSubmitting ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </form>
    </section>
  )
}
