'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { snoozeDealReminder } from '@/services/deal-health.service'
import { formatSnoozedUntil } from '@/lib/deal-health-format'

const SNOOZE_OPTIONS = [7, 14, 30] as const
const DEFAULT_SNOOZE_DAYS = 7

type SnoozeReminderDialogProps = {
  dealId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Snooze dialog for deal health reminders. Uses the project's custom context
 * Dialog (not Radix). onOpenChange is wrapped in handleClose so an ESC/overlay
 * close also resets the selected duration — passing the parent callback
 * straight through would let the previous selection survive into the next open
 * (Story 3.5 finding I1/I2; CompetitorForm.tsx:99 is the correct shape).
 */
export function SnoozeReminderDialog({
  dealId,
  open,
  onOpenChange,
}: SnoozeReminderDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [selectedDays, setSelectedDays] = useState<number>(DEFAULT_SNOOZE_DAYS)

  const mutation = useMutation({
    mutationFn: (days: number) => snoozeDealReminder(dealId, days),
    onSuccess: (snooze) => {
      queryClient.invalidateQueries({ queryKey: ['dealHealth', dealId] })
      onOpenChange(false)
      toast.success(`Reminders snoozed until ${formatSnoozedUntil(snooze.snoozedUntil)}.`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to snooze reminders')
    },
  })

  const handleClose = (): void => {
    setSelectedDays(DEFAULT_SNOOZE_DAYS)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby="snooze-description">
        <DialogHeader>
          <DialogTitle>Snooze reminders</DialogTitle>
          <DialogDescription id="snooze-description">
            Pause deal health reminders for this deal. You won&apos;t receive alerts until the
            snooze period ends.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Snooze duration" className="grid grid-cols-3 gap-2">
          {SNOOZE_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={selectedDays === days}
              onClick={() => setSelectedDays(days)}
              className={cn(
                'min-h-[48px] rounded-lg border px-3 text-sm font-medium transition-colors',
                selectedDays === days
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              {days} days
            </button>
          ))}
        </div>

        <DialogFooter>
          <DialogClose>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            className="h-11"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(selectedDays)}
          >
            {mutation.isPending ? 'Snoozing...' : `Snooze for ${selectedDays} days`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
