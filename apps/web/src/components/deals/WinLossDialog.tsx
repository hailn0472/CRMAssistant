'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { recordWinLoss } from '@/services/competitor.service'
import type { WinLossReason } from '@/services/competitor.service'
import { getCompetitors } from '@/services/competitor.service'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const WIN_LOSS_REASON_LABELS: Record<WinLossReason, string> = {
  PRICE: 'Price',
  FEATURES: 'Features',
  TIMING: 'Timing',
  COMPETITOR: 'Competitor',
  BUDGET: 'Budget',
  OTHER: 'Other',
}

export const WIN_LOSS_REASONS: WinLossReason[] = [
  'PRICE',
  'FEATURES',
  'TIMING',
  'COMPETITOR',
  'BUDGET',
  'OTHER',
]

const winLossSchema = z
  .object({
    reason: z.string().min(1, 'Reason is required'),
    competitorId: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((values) => values.reason !== 'COMPETITOR' || Boolean(values.competitorId), {
    message: 'Competitor is required when reason is Competitor',
    path: ['competitorId'],
  })
  .refine((values) => values.reason !== 'OTHER' || Boolean(values.note?.trim()), {
    message: 'Note is required when reason is Other',
    path: ['note'],
  })

type WinLossFormValues = z.infer<typeof winLossSchema>

type WinLossDialogProps = {
  dealId: string
  stageId: string
  stageName: string
  isWon: boolean
  isLost: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WinLossDialog({
  dealId,
  stageId,
  stageName,
  isWon,
  isLost,
  open,
  onOpenChange,
}: WinLossDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [competitorSearch, setCompetitorSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const { data: competitorsData } = useQuery({
    queryKey: ['competitors', 'search', competitorSearch],
    queryFn: () => getCompetitors(1, 20, { search: competitorSearch || undefined }),
    enabled: showDropdown || open,
  })

  const recordMutation = useMutation({
    mutationFn: (values: WinLossFormValues) =>
      recordWinLoss({
        dealId,
        stageId,
        reason: values.reason as WinLossReason,
        competitorId: values.competitorId || null,
        note: values.note || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] })
      queryClient.invalidateQueries({ queryKey: ['dealCompetitors', dealId] })
      queryClient.invalidateQueries({ queryKey: ['winLoss'] })
      onOpenChange(false)
    },
  })

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<WinLossFormValues>({
    resolver: zodResolver(winLossSchema) as any,
    defaultValues: {
      reason: '',
      competitorId: '',
      note: '',
    },
  })

  const selectedReason = watch('reason')
  const selectedCompetitorId = watch('competitorId')

  const confirmLabel = isWon ? `Mark as Closed Won` : `Mark as Closed Lost`

  const handleCompetitorSelect = (competitorId: string): void => {
    setValue('competitorId', competitorId, { shouldValidate: true })
    setShowDropdown(false)
    setCompetitorSearch('')
  }

  const handleClose = (): void => {
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Record win/loss reason</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((values) => recordMutation.mutate(values))}
          className="space-y-4"
        >
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-500">Moving this deal to</span>{' '}
            <span className="font-semibold text-slate-900">{stageName}</span>
            {isWon && <span className="ml-1 text-green-600">(won)</span>}
            {isLost && <span className="ml-1 text-red-600">(lost)</span>}
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="win-loss-reason">
              Reason
            </label>
            <select
              id="win-loss-reason"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              {...register('reason')}
              aria-invalid={Boolean(errors.reason)}
            >
              <option value="">Select a reason...</option>
              {WIN_LOSS_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {WIN_LOSS_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
            {errors.reason && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.reason.message}
              </span>
            )}
          </div>

          {/* Competitor picker — only for COMPETITOR */}
          {selectedReason === 'COMPETITOR' && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Competitor</label>
              <div className="relative">
                <Input
                  placeholder="Search competitors..."
                  value={competitorSearch}
                  onChange={(e) => {
                    setCompetitorSearch(e.target.value)
                    setShowDropdown(true)
                  }}
                  onFocus={() => setShowDropdown(true)}
                />
                {showDropdown && competitorsData && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {competitorsData.items.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-slate-500">No competitors found</div>
                    ) : (
                      competitorsData.items.map((competitor) => (
                        <button
                          key={competitor.id}
                          type="button"
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
                            selectedCompetitorId === competitor.id ? 'bg-indigo-50 font-medium' : ''
                          }`}
                          onClick={() => handleCompetitorSelect(competitor.id)}
                        >
                          {competitor.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <input type="hidden" {...register('competitorId')} />
              {errors.competitorId && (
                <span className="text-xs font-medium text-red-700" role="alert">
                  {errors.competitorId.message}
                </span>
              )}
            </div>
          )}

          {/* Note — required for OTHER */}
          {selectedReason === 'OTHER' && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700" htmlFor="win-loss-note">
                Note
              </label>
              <textarea
                id="win-loss-note"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                placeholder="Explain why this deal was won or lost..."
                {...register('note')}
                aria-invalid={Boolean(errors.note)}
              />
              {errors.note && (
                <span className="text-xs font-medium text-red-700" role="alert">
                  {errors.note.message}
                </span>
              )}
            </div>
          )}

          {/* Server error */}
          {recordMutation.isError && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {recordMutation.error instanceof Error
                ? recordMutation.error.message
                : 'Failed to record win/loss'}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={recordMutation.isPending}>
              {recordMutation.isPending ? 'Saving...' : confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
