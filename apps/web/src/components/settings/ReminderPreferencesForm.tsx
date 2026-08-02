'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormSkeleton } from '@/components/shared'
import { cn } from '@/lib/utils'
import { getMyReminderPreferences, updateReminderPreferences } from '@/services/deal-health.service'

const reminderPreferencesSchema = z.object({
  emailFrequency: z.enum(['DAILY', 'WEEKLY', 'OFF']),
  notifyNoActivity: z.boolean(),
  notifyClosingSoon: z.boolean(),
  notifyAtRisk: z.boolean(),
})

type ReminderPreferencesValues = z.infer<typeof reminderPreferencesSchema>

const FREQUENCY_HELP: Record<ReminderPreferencesValues['emailFrequency'], string> = {
  DAILY: 'Sends every day.',
  WEEKLY: 'Sends on Mondays only.',
  OFF: 'Suppresses all emails.',
}

const TOGGLE_FIELDS: Array<{
  key: 'notifyNoActivity' | 'notifyClosingSoon' | 'notifyAtRisk'
  label: string
  description: string
  ariaLabel: string
}> = [
  {
    key: 'notifyNoActivity',
    label: 'No activity',
    description: 'Notify when a deal has no activity for 7+ days',
    ariaLabel: 'No activity notifications',
  },
  {
    key: 'notifyClosingSoon',
    label: 'Closing soon',
    description: 'Notify when a deal is closing within 3 days',
    ariaLabel: 'Closing soon notifications',
  },
  {
    key: 'notifyAtRisk',
    label: 'At risk',
    description: "Notify when a deal's health score drops below 70",
    ariaLabel: 'At risk notifications',
  },
]

export function ReminderPreferencesForm(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: prefs, isLoading } = useQuery({
    queryKey: ['myReminderPreferences'],
    queryFn: getMyReminderPreferences,
  })

  const {
    control,
    watch,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ReminderPreferencesValues>({
    resolver: zodResolver(reminderPreferencesSchema) as never,
    values: (prefs ?? {
      emailFrequency: 'DAILY',
      notifyNoActivity: true,
      notifyClosingSoon: true,
      notifyAtRisk: true,
    }) as ReminderPreferencesValues,
  })

  const emailFrequency = watch('emailFrequency')

  const mutation = useMutation({
    mutationFn: (input: ReminderPreferencesValues) => updateReminderPreferences(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myReminderPreferences'] })
      toast.success('Reminder preferences updated.')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update preferences')
    },
  })

  const onSubmit = (values: ReminderPreferencesValues): void => {
    mutation.mutate(values)
  }

  if (isLoading) {
    return <FormSkeleton />
  }

  return (
    <Card className="max-w-[560px] border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-slate-950">Reminder Preferences</CardTitle>
        <CardDescription>Choose how and when you receive deal health reminders.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div>
            <label
              htmlFor="email-frequency"
              className="mb-1.5 block text-sm font-medium text-slate-800"
            >
              Email Frequency
            </label>
            <Controller
              control={control}
              name="emailFrequency"
              render={({ field }) => (
                <select
                  id="email-frequency"
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly (Mondays)</option>
                  <option value="OFF">Off</option>
                </select>
              )}
            />
            <p className="mt-1 text-xs text-slate-500">{FREQUENCY_HELP[emailFrequency]}</p>
          </div>

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
