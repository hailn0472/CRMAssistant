import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { ReminderPreferencesForm } from '../ReminderPreferencesForm'
import { getMyReminderPreferences, updateReminderPreferences } from '@/services/deal-health.service'

jest.mock('@/services/deal-health.service', () => ({
  getMyReminderPreferences: jest.fn(),
  updateReminderPreferences: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const defaultPrefs = {
  emailFrequency: 'DAILY',
  notifyNoActivity: true,
  notifyClosingSoon: true,
  notifyAtRisk: true,
}

function renderForm(): ReturnType<typeof render> {
  ;(getMyReminderPreferences as jest.Mock).mockResolvedValue(defaultPrefs)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReminderPreferencesForm />
    </QueryClientProvider>,
  )
}

describe('ReminderPreferencesForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the frequency selector and the three toggles with defaults (AC 53)', async () => {
    renderForm()

    expect(await screen.findByLabelText(/email frequency/i)).toHaveValue('DAILY')
    expect(screen.getByLabelText('No activity notifications')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByLabelText('Closing soon notifications')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByLabelText('At risk notifications')).toHaveAttribute('aria-checked', 'true')
  })

  it('submits the changed frequency and toggles as the correct payload (AC 53)', async () => {
    ;(updateReminderPreferences as jest.Mock).mockResolvedValue({
      emailFrequency: 'WEEKLY',
      notifyNoActivity: true,
      notifyClosingSoon: false,
      notifyAtRisk: true,
    })
    renderForm()

    fireEvent.change(await screen.findByLabelText(/email frequency/i), {
      target: { value: 'WEEKLY' },
    })
    fireEvent.click(screen.getByLabelText('Closing soon notifications'))
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(updateReminderPreferences).toHaveBeenCalledWith({
        emailFrequency: 'WEEKLY',
        notifyNoActivity: true,
        notifyClosingSoon: false,
        notifyAtRisk: true,
      })
    })
    expect(toast.success).toHaveBeenCalledWith('Reminder preferences updated.')
  })

  it('shows an error toast when the save fails', async () => {
    ;(updateReminderPreferences as jest.Mock).mockRejectedValue(new Error('Save failed'))
    renderForm()

    await screen.findByLabelText(/email frequency/i)
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Save failed')
    })
  })

  it('meets the 44px touch targets on the select and the toggle switches (AC 56)', async () => {
    renderForm()

    const select = await screen.findByLabelText(/email frequency/i)
    expect(select.className).toContain('min-h-[44px]')

    const toggle = screen.getByLabelText('No activity notifications')
    expect(toggle.className).toContain('w-[44px]')
    expect(toggle.className).toContain('h-[24px]')
  })
})
