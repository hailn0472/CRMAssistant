'use client'

/**
 * Story 6.2 — create/edit saved report dialog (AC 70).
 *
 * Shared Dialog + React Hook Form + Zod v4 with inline errors, submit loading
 * state, name/type/public/config fields, and `['salesReports','list']`
 * invalidation on success. Delete requires an explicit confirmation step.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createReport, updateReport, deleteReport } from '@/services/sales-report.service'
import type {
  CreateReportInput,
  DatePreset,
  ReportConfig,
  ReportGroupBy,
  ReportRow,
  ReportType,
} from '@/services/sales-report.service'
import { REPORT_TYPE_TEMPLATES } from '@/lib/sales-report-format'

const reportFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Report name is required').max(120, 'Max 120 characters'),
    type: z.enum([
      'SALES_OVERVIEW',
      'PIPELINE_ANALYSIS',
      'WIN_LOSS',
      'REVENUE_FORECAST',
      'TEAM_PERFORMANCE',
      'DEAL_VELOCITY',
    ]),
    isPublic: z.boolean(),
    datePreset: z.enum(['THIS_MONTH', 'THIS_QUARTER', 'THIS_YEAR', 'CUSTOM']),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    comparisonMode: z.enum(['NONE', 'PREVIOUS_PERIOD', 'YEAR_OVER_YEAR', 'CUSTOM']),
    comparisonStartDate: z.string().optional(),
    comparisonEndDate: z.string().optional(),
    groupBy: z.enum(['MONTH', 'QUARTER', 'YEAR', 'OWNER', 'TEAM', 'PRODUCT']),
    currency: z.string().optional(),
  })
  .refine((values) => values.datePreset !== 'CUSTOM' || (values.startDate && values.endDate), {
    message: 'Custom preset requires a start and end date',
    path: ['startDate'],
  })

type ReportFormValues = z.infer<typeof reportFormSchema>

type SavedReportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits this report; otherwise it creates a new one. */
  report?: ReportRow | null
  onSaved?: (report: ReportRow) => void
  /** Controls the delete affordance (AC 67) — delete itself stays confirmed. */
  canDelete?: boolean
}

const EMPTY_VALUES: ReportFormValues = {
  name: '',
  type: 'SALES_OVERVIEW',
  isPublic: false,
  datePreset: 'THIS_MONTH',
  startDate: '',
  endDate: '',
  comparisonMode: 'PREVIOUS_PERIOD',
  comparisonStartDate: '',
  comparisonEndDate: '',
  groupBy: 'MONTH',
  currency: '',
}

function configToValues(config: ReportConfig): ReportFormValues {
  return {
    name: '',
    type: 'SALES_OVERVIEW',
    isPublic: false,
    datePreset: config.datePreset,
    startDate: config.startDate ?? '',
    endDate: config.endDate ?? '',
    comparisonMode: config.comparisonMode,
    comparisonStartDate: config.comparisonStartDate ?? '',
    comparisonEndDate: config.comparisonEndDate ?? '',
    groupBy: config.groupBy,
    currency: config.currency ?? '',
  }
}

function valuesToConfig(values: ReportFormValues, _type: ReportType): ReportConfig {
  return {
    datePreset: values.datePreset as DatePreset,
    startDate: values.startDate || null,
    endDate: values.endDate || null,
    comparisonMode: values.comparisonMode,
    comparisonStartDate: values.comparisonStartDate || null,
    comparisonEndDate: values.comparisonEndDate || null,
    groupBy: values.groupBy as ReportGroupBy,
    ownerId: null,
    teamId: null,
    stageId: null,
    productId: null,
    currency: values.currency || null,
  }
}

export function SavedReportDialog({
  open,
  onOpenChange,
  report,
  onSaved,
  canDelete = true,
}: SavedReportDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const isEditing = !!report
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReportFormValues>({
    resolver: zodResolver(reportFormSchema),
    defaultValues: EMPTY_VALUES,
  })

  const datePreset = watch('datePreset')

  useEffect(() => {
    if (open) {
      setConfirmingDelete(false)
      if (report) {
        reset({
          ...configToValues(report.config),
          name: report.name,
          type: report.type as ReportType,
          isPublic: report.isPublic,
        })
      } else {
        reset(EMPTY_VALUES)
      }
    }
  }, [open, report, reset])

  function handleTypeChange(nextType: ReportType): void {
    setValue('type', nextType)
    const template = REPORT_TYPE_TEMPLATES.find((t) => t.type === nextType)
    if (template && !report) {
      setValue('datePreset', template.config.datePreset)
      setValue('comparisonMode', template.config.comparisonMode)
      setValue('groupBy', template.config.groupBy)
    }
  }

  const createMutation = useMutation({
    mutationFn: (input: CreateReportInput) => createReport(input),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['salesReports', 'list'] })
      toast.success('Report saved')
      onOpenChange(false)
      onSaved?.(saved)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not save report')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: CreateReportInput) => updateReport(report!.id, input),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['salesReports', 'list'] })
      queryClient.invalidateQueries({ queryKey: ['salesReports', 'detail', report!.id] })
      toast.success('Report updated')
      onOpenChange(false)
      onSaved?.(saved)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not update report')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteReport(report!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesReports', 'list'] })
      toast.success('Report deleted')
      onOpenChange(false)
      onSaved?.(undefined as unknown as ReportRow)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not delete report')
    },
  })

  async function onSubmit(values: ReportFormValues): Promise<void> {
    const input: CreateReportInput = {
      name: values.name,
      type: values.type as ReportType,
      isPublic: values.isPublic,
      config: valuesToConfig(values, values.type as ReportType),
    }
    if (isEditing) {
      await updateMutation.mutateAsync(input)
    } else {
      await createMutation.mutateAsync(input)
    }
  }

  const fieldClass =
    'h-9 rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f]'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit report' : 'New report'}</DialogTitle>
        </DialogHeader>

        {isEditing && confirmingDelete ? (
          <div className="space-y-4">
            <p className="text-[13.5px] text-[#4b4b55]">
              Delete &quot;{report?.name}&quot;? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete report'}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-[#8c8c96]">Name</span>
              <Input
                {...register('name')}
                placeholder="e.g. August pipeline review"
                aria-invalid={!!errors.name}
                className={fieldClass}
              />
              {errors.name ? (
                <span role="alert" className="text-[12px] text-red-600">
                  {errors.name.message}
                </span>
              ) : null}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-[#8c8c96]">Report type</span>
              <select
                {...register('type')}
                onChange={(e) => handleTypeChange(e.target.value as ReportType)}
                className={`${fieldClass} cursor-pointer`}
              >
                {REPORT_TYPE_TEMPLATES.map((template) => (
                  <option key={template.type} value={template.type}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[#8c8c96]">Date preset</span>
                <select {...register('datePreset')} className={`${fieldClass} cursor-pointer`}>
                  <option value="THIS_MONTH">This month</option>
                  <option value="THIS_QUARTER">This quarter</option>
                  <option value="THIS_YEAR">This year</option>
                  <option value="CUSTOM">Custom range</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[#8c8c96]">Group by</span>
                <select {...register('groupBy')} className={`${fieldClass} cursor-pointer`}>
                  <option value="MONTH">Month</option>
                  <option value="QUARTER">Quarter</option>
                  <option value="YEAR">Year</option>
                  <option value="OWNER">Owner</option>
                  <option value="TEAM">Team</option>
                  <option value="PRODUCT">Product</option>
                </select>
              </label>
            </div>

            {datePreset === 'CUSTOM' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-[#8c8c96]">Start date</span>
                  <input type="date" {...register('startDate')} className={fieldClass} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-[#8c8c96]">End date</span>
                  <input type="date" {...register('endDate')} className={fieldClass} />
                </label>
                {errors.startDate ? (
                  <span role="alert" className="text-[12px] text-red-600 sm:col-span-2">
                    {errors.startDate.message}
                  </span>
                ) : null}
              </div>
            ) : null}

            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-[#8c8c96]">Comparison</span>
              <select {...register('comparisonMode')} className={`${fieldClass} cursor-pointer`}>
                <option value="NONE">No comparison</option>
                <option value="PREVIOUS_PERIOD">Previous period</option>
                <option value="YEAR_OVER_YEAR">Year over year</option>
                <option value="CUSTOM">Custom dates</option>
              </select>
            </label>

            {watch('comparisonMode') === 'CUSTOM' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-[#8c8c96]">Comparison start</span>
                  <input type="date" {...register('comparisonStartDate')} className={fieldClass} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-[#8c8c96]">Comparison end</span>
                  <input type="date" {...register('comparisonEndDate')} className={fieldClass} />
                </label>
              </div>
            ) : null}

            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-[#8c8c96]">Currency (optional)</span>
              <Input {...register('currency')} placeholder="USD" className={fieldClass} />
            </label>

            <label className="flex items-center gap-2.5 text-[13px] text-[#4b4b55]">
              <input type="checkbox" {...register('isPublic')} className="h-4 w-4" />
              Public in this workspace (read/run only)
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div>
                {isEditing && canDelete ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmingDelete(true)}
                    className="text-red-600"
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
                >
                  {isSubmitting ? 'Saving…' : isEditing ? 'Save changes' : 'Create report'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
