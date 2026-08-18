'use client'

/**
 * Story 6.5 — Reusable Accessible ScheduleReportDialog component (Contract F30).
 * Handles create and edit mode for report scheduling across sales & custom report surfaces.
 * 44px min touch targets, visible labels, keyboard accessibility, Zod validation.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useId } from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  calculateNextRunPreview,
  getDefaultReportScheduleFormValues,
  reportScheduleFormSchema,
  validateRecipientEmail,
} from '@/lib/report-schedule-form'
import type { ReportScheduleFormValues } from '@/lib/report-schedule-form'
import {
  reportScheduleKeys,
  scheduleReport,
  updateSchedule,
} from '@/services/report-schedule.service'
import type {
  ReportDeliveryFormat,
  ReportSchedule,
  ReportScheduleFrequency,
  ScheduleReportInput,
} from '@/services/report-schedule.service'

const FREQUENCY_OPTIONS: Array<{ value: ReportScheduleFrequency; label: string }> = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'CUSTOM_CRON', label: 'Cron' },
]

const DAYS_OF_WEEK = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

const TIMEZONE_OPTIONS = [
  'Asia/Ho_Chi_Minh',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
]

const FORMAT_OPTIONS: Array<{
  value: ReportDeliveryFormat
  title: string
  desc: string
}> = [
  {
    value: 'PDF',
    title: 'PDF Document',
    desc: 'Branded executive layout with charts & summary.',
  },
  {
    value: 'EXCEL',
    title: 'Excel (.xlsx)',
    desc: 'Multi-sheet workbook with typed formulas.',
  },
  {
    value: 'CSV',
    title: 'CSV Plain',
    desc: 'Raw tabular data for automation & scripts.',
  },
]

export type ScheduleReportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportId: string
  reportName?: string
  reportType?: string
  schedule?: ReportSchedule | null
}

export function ScheduleReportDialog({
  open,
  onOpenChange,
  reportId,
  reportName = 'Saved Report',
  reportType = 'REPORT',
  schedule,
}: ScheduleReportDialogProps) {
  const queryClient = useQueryClient()
  const [recipientInput, setRecipientInput] = useState('')
  const [recipientError, setRecipientError] = useState<string | null>(null)

  const isEditMode = Boolean(schedule)
  const scheduledTimeId = useId()
  const timezoneId = useId()
  const dayOfMonthId = useId()
  const quarterCycleId = useId()
  const quarterDomId = useId()
  const cronExprId = useId()

  const form = useForm<ReportScheduleFormValues>({
    resolver: zodResolver(reportScheduleFormSchema),
    defaultValues: getDefaultReportScheduleFormValues(),
    mode: 'onChange',
  })

  const {
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = form

  const frequency = watch('frequency')
  const recipients = watch('recipients') || []
  const format = watch('format')
  const scheduledTime = watch('scheduledTime')
  const timezone = watch('timezone')
  const dayOfWeek = watch('dayOfWeek')
  const dayOfMonth = watch('dayOfMonth')
  const startMonth = watch('startMonth')
  const cronExpression = watch('cronExpression')

  // Reset form when dialog opens or schedule prop changes
  useEffect(() => {
    if (open) {
      if (schedule) {
        reset({
          frequency: schedule.frequency,
          recipients: [...schedule.recipients],
          format: schedule.format,
          timezone: schedule.timezone,
          scheduledTime: schedule.scheduledTime,
          dayOfWeek: schedule.dayOfWeek ?? 1,
          dayOfMonth: schedule.dayOfMonth ?? 1,
          startMonth: schedule.startMonth ?? 1,
          cronExpression: schedule.cronExpression ?? '0 8 * * 1-5',
        })
      } else {
        reset(getDefaultReportScheduleFormValues())
      }
      setRecipientInput('')
      setRecipientError(null)
    }
  }, [open, schedule, reset])

  const createMutation = useMutation({
    mutationFn: (input: ScheduleReportInput) => scheduleReport(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportScheduleKeys.all })
      toast.success('Report schedule created successfully')
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create schedule')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (values: ReportScheduleFormValues) => updateSchedule(schedule!.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportScheduleKeys.all })
      toast.success('Report schedule updated successfully')
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update schedule')
    },
  })

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  const handleAddRecipient = () => {
    const trimmed = recipientInput.trim().toLowerCase()
    if (!trimmed) return

    if (!validateRecipientEmail(trimmed)) {
      setRecipientError('Please enter a valid email address.')
      return
    }

    if (recipients.includes(trimmed)) {
      setRecipientError('This email recipient is already added.')
      return
    }

    if (recipients.length >= 50) {
      setRecipientError('Maximum 50 recipients per schedule.')
      return
    }

    setRecipientError(null)
    setValue('recipients', [...recipients, trimmed], { shouldValidate: true })
    setRecipientInput('')
  }

  const handleRemoveRecipient = (emailToRemove: string) => {
    setValue(
      'recipients',
      recipients.filter((r) => r !== emailToRemove),
      { shouldValidate: true },
    )
  }

  const onSubmit = (values: ReportScheduleFormValues) => {
    if (isEditMode && schedule) {
      updateMutation.mutate(values)
    } else {
      createMutation.mutate({
        ...values,
        reportId,
      })
    }
  }

  // Calculated next occurrence preview
  const nextRunPreview = calculateNextRunPreview({
    frequency,
    scheduledTime,
    timezone,
    dayOfWeek,
    dayOfMonth,
    startMonth,
    cronExpression,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[620px] max-h-[90vh] flex flex-col p-0 overflow-hidden"
        aria-describedby="schedule-dialog-description"
      >
        <DialogHeader className="px-6 py-4 border-b border-[#ececf0] bg-[#fafafb]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
              📅
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-[#1b1b1f]">
                {isEditMode ? 'Edit Report Schedule' : 'Schedule Report Delivery'}
              </DialogTitle>
              <p id="schedule-dialog-description" className="text-[12.5px] text-[#77777f]">
                Configure automated email delivery cadence and recipients.
              </p>
            </div>
          </div>
        </DialogHeader>

        <form
          id="schedule-report-form"
          onSubmit={handleSubmit(onSubmit)}
          className="p-6 overflow-y-auto space-y-5 text-[13px]"
        >
          {/* Report Context Strip */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#8c8c96] mb-1.5">
              Selected Report
            </label>
            <div className="flex items-center justify-between p-3 rounded-[10px] border border-[#e6e6eb] bg-[#fafafb]">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                <span className="font-semibold text-[#1b1b1f]">{reportName}</span>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                  {reportType}
                </span>
              </div>
            </div>
          </div>

          {/* Frequency Selector Pills */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#8c8c96] mb-1.5">
              Frequency <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-5 gap-1.5 p-1 rounded-[10px] border border-[#e6e6eb] bg-[#fafafb]">
              {FREQUENCY_OPTIONS.map((opt) => {
                const isSelected = frequency === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setValue('frequency', opt.value, { shouldValidate: true })}
                    className={`min-target py-2 rounded-[7px] text-[12px] font-medium text-center transition-all ${
                      isSelected
                        ? 'bg-[#1b1b1f] text-white shadow-xs'
                        : 'text-[#4b4b55] hover:bg-[#f4f4f6]'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Conditional Cadence Fields */}
          {frequency === 'WEEKLY' && (
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-[#4b4b55]">Day of Week</label>
              <div className="grid grid-cols-7 gap-1">
                {DAYS_OF_WEEK.map((d) => {
                  const isSelected = dayOfWeek === d.value
                  return (
                    <button
                      key={d.value}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setValue('dayOfWeek', d.value, { shouldValidate: true })}
                      className={`min-target py-1.5 rounded-lg border text-[12px] ${
                        isSelected
                          ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white font-semibold'
                          : 'border-[#e6e6eb] bg-white text-[#4b4b55] font-medium hover:bg-[#f4f4f6]'
                      }`}
                    >
                      {d.label}
                    </button>
                  )
                })}
              </div>
              {errors.dayOfWeek && (
                <p className="text-[11.5px] text-rose-600">{errors.dayOfWeek.message}</p>
              )}
            </div>
          )}

          {frequency === 'MONTHLY' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={dayOfMonthId}
                  className="block text-[12px] font-medium text-[#4b4b55]"
                >
                  Day of Month
                </label>
                <span className="text-[11px] text-[#8c8c96]">Clamped on short months (28-31)</span>
              </div>
              <select
                id={dayOfMonthId}
                value={dayOfMonth ?? 1}
                onChange={(e) =>
                  setValue('dayOfMonth', Number(e.target.value), { shouldValidate: true })
                }
                className="w-full h-10 min-target rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[13px] text-[#1b1b1f] focus:border-[#1b1b1f]"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    Day {day} {day === 1 ? '(First day)' : day === 31 ? '(Last day)' : ''}
                  </option>
                ))}
              </select>
              {errors.dayOfMonth && (
                <p className="text-[11.5px] text-rose-600">{errors.dayOfMonth.message}</p>
              )}
            </div>
          )}

          {frequency === 'QUARTERLY' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor={quarterCycleId}
                  className="block text-[12px] font-medium text-[#4b4b55] mb-1"
                >
                  Quarter Cycle
                </label>
                <select
                  id={quarterCycleId}
                  value={startMonth ?? 1}
                  onChange={(e) =>
                    setValue('startMonth', Number(e.target.value), { shouldValidate: true })
                  }
                  className="w-full h-10 min-target rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[13px] text-[#1b1b1f] focus:border-[#1b1b1f]"
                >
                  <option value={1}>Jan, Apr, Jul, Oct (Calendar Q)</option>
                  <option value={2}>Feb, May, Aug, Nov</option>
                  <option value={3}>Mar, Jun, Sep, Dec (Fiscal Q)</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor={quarterDomId}
                  className="block text-[12px] font-medium text-[#4b4b55] mb-1"
                >
                  Day of Month
                </label>
                <select
                  id={quarterDomId}
                  value={dayOfMonth ?? 1}
                  onChange={(e) =>
                    setValue('dayOfMonth', Number(e.target.value), { shouldValidate: true })
                  }
                  className="w-full h-10 min-target rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[13px] text-[#1b1b1f] focus:border-[#1b1b1f]"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={day}>
                      Day {day}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {frequency === 'CUSTOM_CRON' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={cronExprId}
                  className="block text-[12px] font-medium text-[#4b4b55]"
                >
                  5-Field Cron Expression
                </label>
                <span className="text-[11px] text-amber-600 font-medium">
                  Minimum cadence: 1 hour
                </span>
              </div>
              <Input
                id={cronExprId}
                type="text"
                placeholder="e.g. 0 8 * * 1-5"
                value={cronExpression || ''}
                onChange={(e) =>
                  setValue('cronExpression', e.target.value, { shouldValidate: true })
                }
                className="font-mono h-10 min-target"
              />
              {errors.cronExpression && (
                <p className="text-[11.5px] text-rose-600">{errors.cronExpression.message}</p>
              )}
            </div>
          )}

          {/* Time & Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={scheduledTimeId}
                className="block text-[12px] font-semibold uppercase tracking-wider text-[#8c8c96] mb-1.5"
              >
                Delivery Time (Local) <span className="text-rose-500">*</span>
              </label>
              <Input
                id={scheduledTimeId}
                type="time"
                value={scheduledTime}
                onChange={(e) =>
                  setValue('scheduledTime', e.target.value, { shouldValidate: true })
                }
                className="h-10 min-target"
              />
              {errors.scheduledTime && (
                <p className="text-[11.5px] text-rose-600">{errors.scheduledTime.message}</p>
              )}
            </div>
            <div>
              <label
                htmlFor={timezoneId}
                className="block text-[12px] font-semibold uppercase tracking-wider text-[#8c8c96] mb-1.5"
              >
                Timezone (IANA) <span className="text-rose-500">*</span>
              </label>
              <select
                id={timezoneId}
                value={timezone}
                onChange={(e) => setValue('timezone', e.target.value, { shouldValidate: true })}
                className="w-full h-10 min-target rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[13px] text-[#1b1b1f] focus:border-[#1b1b1f]"
              >
                {!TIMEZONE_OPTIONS.includes(timezone) && (
                  <option value={timezone}>{timezone}</option>
                )}
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Recipients Management */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[12px] font-semibold uppercase tracking-wider text-[#8c8c96]">
                Recipients (Email Addresses) <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11.5px] text-[#77777f]">{recipients.length} / 50 max</span>
            </div>

            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Enter email address (e.g. colleague@acme.corp)"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddRecipient()
                  }
                }}
                className="h-10 min-target flex-1"
              />
              <Button
                type="button"
                onClick={handleAddRecipient}
                className="h-10 min-target px-4 bg-[#1b1b1f] hover:bg-black text-white shrink-0"
              >
                Add
              </Button>
            </div>

            {recipientError && <p className="text-[11.5px] text-rose-600 mt-1">{recipientError}</p>}
            {errors.recipients && (
              <p className="text-[11.5px] text-rose-600 mt-1">{errors.recipients.message}</p>
            )}

            <div className="flex flex-wrap gap-1.5 mt-2.5 p-2 rounded-[9px] border border-[#ececf0] bg-[#fafafb] min-h-[46px]">
              {recipients.length === 0 ? (
                <span className="text-[12px] text-[#8c8c96] italic p-1">
                  No recipients added yet. Add at least one email address.
                </span>
              ) : (
                recipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[#e6e6eb] px-3 py-1 text-[12px] text-[#1b1b1f] shadow-xs"
                  >
                    <span>{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecipient(email)}
                      aria-label={`Remove ${email}`}
                      className="min-target p-1 text-[#8c8c96] hover:text-rose-600"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Delivery Format Radios */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#8c8c96] mb-1.5">
              Delivery Format <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {FORMAT_OPTIONS.map((opt) => {
                const isSelected = format === opt.value
                return (
                  <label
                    key={opt.value}
                    className={`min-target flex flex-col p-3 rounded-[10px] cursor-pointer transition-all ${
                      isSelected
                        ? 'border-2 border-[#1b1b1f] bg-slate-50/50'
                        : 'border border-[#e6e6eb] bg-white hover:bg-[#fafafb]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="deliveryFormat"
                      value={opt.value}
                      checked={isSelected}
                      onChange={() => setValue('format', opt.value, { shouldValidate: true })}
                      className="sr-only"
                    />
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-[13.5px] text-[#1b1b1f]">
                        {opt.title}
                      </span>
                      <span
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          isSelected ? 'border-[#1b1b1f]' : 'border-[#cbd5e1]'
                        }`}
                      >
                        {isSelected && <span className="w-2 h-2 rounded-full bg-[#1b1b1f]" />}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-[#77777f]">{opt.desc}</p>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Next Run Occurrence Preview */}
          <div className="p-3.5 rounded-[10px] border border-indigo-100 bg-indigo-50/50 flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
              ⚡
            </div>
            <div>
              <div className="text-[12px] font-semibold text-indigo-950 uppercase tracking-wide">
                Next Scheduled Occurrence Preview
              </div>
              <div className="font-bold text-[13.5px] text-indigo-900 mt-0.5">
                {nextRunPreview
                  ? `${nextRunPreview.toLocaleString('en-US', {
                      timeZone: timezone,
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })} (${timezone})`
                  : '— (Invalid cadence or no future occurrence)'}
              </div>
              <div className="text-[11px] text-indigo-700 font-mono mt-0.5">
                {nextRunPreview ? `UTC: ${nextRunPreview.toISOString()}` : ''}
              </div>
            </div>
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-[#ececf0] flex items-center justify-between bg-[#fafafb]">
          <span className="text-[11.5px] text-[#8c8c96] hidden sm:inline">
            Schedules execute via hourly background workers.
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="min-target px-4 py-2"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="schedule-report-form"
              disabled={isSubmitting}
              className="min-target px-5 py-2 bg-[#1b1b1f] hover:bg-black text-white"
            >
              {isSubmitting ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Schedule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
