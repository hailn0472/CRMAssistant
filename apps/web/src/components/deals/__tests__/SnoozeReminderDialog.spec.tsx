import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { SnoozeReminderDialog } from '../SnoozeReminderDialog'
import { snoozeDealReminder } from '@/services/deal-health.service'

jest.mock('@/services/deal-health.service', () => ({
  snoozeDealReminder: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

function renderDialog(
  open = true,
  onOpenChange = jest.fn(),
): ReturnType<typeof render> & {
  onOpenChange: jest.Mock
} {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SnoozeReminderDialog dealId="deal-1" open={open} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return { ...result, onOpenChange }
}

describe('SnoozeReminderDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('opens with 7 days pre-selected and offers exactly 7/14/30 (AC 50)', () => {
    renderDialog()

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios[0]).toHaveTextContent('7 days')
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    expect(radios[1]).toHaveTextContent('14 days')
    expect(radios[1]).toHaveAttribute('aria-checked', 'false')
    expect(radios[2]).toHaveTextContent('30 days')
    expect(radios[2]).toHaveAttribute('aria-checked', 'false')
    // 5 days is not offered
    expect(screen.queryByText('5 days')).not.toBeInTheDocument()
  })

  it('confirm button reflects the selected duration', () => {
    renderDialog()

    expect(screen.getByText('Snooze for 7 days')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '14 days' }))
    expect(screen.getByText('Snooze for 14 days')).toBeInTheDocument()
  })

  it('resets the selection to 7 after an ESC close, so the next open starts fresh (AC 50)', () => {
    const { onOpenChange, unmount } = renderDialog()

    fireEvent.click(screen.getByRole('radio', { name: '14 days' }))
    expect(screen.getByText('Snooze for 14 days')).toBeInTheDocument()

    // ESC close goes through the Dialog's own onKeyDown → onOpenChange(false)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)

    unmount()

    renderDialog(true)
    expect(screen.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Snooze for 7 days')).toBeInTheDocument()
  })

  it('submits the selected days and toasts the snoozed-until date', async () => {
    ;(snoozeDealReminder as jest.Mock).mockResolvedValue({
      id: 'snooze-1',
      dealId: 'deal-1',
      snoozedUntil: '2026-08-08T00:00:00.000Z',
    })
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('radio', { name: '30 days' }))
    fireEvent.click(screen.getByText('Snooze for 30 days'))

    await waitFor(() => {
      expect(snoozeDealReminder).toHaveBeenCalledWith('deal-1', 30)
    })
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
    expect(toast.success).toHaveBeenCalledWith(
      `Reminders snoozed until ${new Date('2026-08-08T00:00:00.000Z').toLocaleDateString()}.`,
    )
  })

  it('toasts an error when the mutation fails', async () => {
    ;(snoozeDealReminder as jest.Mock).mockRejectedValue(new Error('Snooze failed'))
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByText('Snooze for 7 days'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Snooze failed')
    })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('meets the 44px touch target on the confirm button and the duration options', () => {
    renderDialog()

    const confirm = screen.getByText('Snooze for 7 days')
    expect(confirm.className).toContain('h-11')
    const option = screen.getByRole('radio', { name: '7 days' })
    expect(option.className).toContain('min-h-[48px]')
  })
})
