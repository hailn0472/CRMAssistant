'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { FormSkeleton } from '@/components/shared'
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
    <section className="max-w-[560px] rounded-[14px] border border-[#ececf0] bg-white px-[22px] py-5">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[18px]">
        <label className="flex max-w-[320px] flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[#4b4b55]">Email frequency</span>
          <Controller
            control={control}
            name="emailFrequency"
            render={({ field }) => (
              <select
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                className="min-h-[44px] w-full cursor-pointer appearance-none rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13.5px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f] focus:bg-white"
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly (Mondays)</option>
                <option value="OFF">Off</option>
              </select>
            )}
          />
          <span className="text-[11.5px] text-[#a0a0aa]">{FREQUENCY_HELP[emailFrequency]}</span>
        </label>

        <div className="flex flex-col border-t border-[#f2f2f5]">
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

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-9 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {isSubmitting ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </form>
    </section>
  )
}
