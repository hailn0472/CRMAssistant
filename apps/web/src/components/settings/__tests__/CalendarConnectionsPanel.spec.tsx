import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { CalendarConnectionsPanel } from '../CalendarConnectionsPanel'
import {
  getCalendarConnections,
  getCalendarAuthUrl,
  disconnectCalendar,
  syncCalendar,
} from '@/services/calendar.service'
import type { CalendarConnection } from '@/services/calendar.service'

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

jest.mock('@/services/calendar.service', () => ({
  getCalendarConnections: jest.fn(),
  getCalendarAuthUrl: jest.fn(),
  disconnectCalendar: jest.fn(),
  syncCalendar: jest.fn(),
  CALENDAR_PROVIDERS: ['GOOGLE', 'OUTLOOK'],
}))

const connectedGoogle: CalendarConnection = {
  id: 'conn-1',
  provider: 'GOOGLE',
  externalAccountEmail: 'owner@example.com',
  calendarId: 'primary',
  status: 'ACTIVE',
  lastSyncedAt: '2026-08-05T10:00:00.000Z',
  lastSyncError: null,
  createdAt: '2026-08-01T00:00:00.000Z',
}

function renderPanel(queryClient?: QueryClient): ReturnType<typeof render> {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CalendarConnectionsPanel />
    </QueryClientProvider>,
  )
}

describe('CalendarConnectionsPanel (Story 4.3 AC 4/19/40/44)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Concrete default — TanStack Query v5 treats undefined as an error.
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([])
  })

  it('renders one row per provider with a Connect action when nothing is connected', async () => {
    renderPanel()

    expect(await screen.findByText('Google Calendar')).toBeInTheDocument()
    expect(screen.getByText('Outlook Calendar')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Connect/ })).toHaveLength(2)
    expect(screen.getAllByText('Not connected')).toHaveLength(2)
  })

  it('renders the Connected badge with colour paired with text (WCAG 2.1 AA)', async () => {
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([connectedGoogle])
    renderPanel()

    const badge = await screen.findByText('Connected')
    expect(badge).toBeInTheDocument()
    // Colour is paired with the text label, not colour alone.
    expect(badge.className).toContain('text-emerald-700')
    expect(badge.textContent).toBe('Connected')
  })

  it('renders the Degraded badge for REAUTH_REQUIRED and for ACTIVE with lastSyncError', async () => {
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([
      { ...connectedGoogle, status: 'REAUTH_REQUIRED', lastSyncError: 'reconnect required' },
    ])
    renderPanel()

    const degraded = await screen.findByText('Degraded')
    expect(degraded.className).toContain('text-amber-700')
    expect(screen.getByText('reconnect required')).toBeInTheDocument()
  })

  it('shows the last-synced timestamp and a Sync now button that invalidates', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([connectedGoogle])
    ;(syncCalendar as jest.Mock).mockResolvedValue(true)
    renderPanel(queryClient)

    expect(await screen.findByText(/Last synced \d/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }))

    await waitFor(() => {
      expect(syncCalendar).toHaveBeenCalledWith('GOOGLE')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['calendarConnections'] })
    })
  })

  it('disconnect confirms before mutating and the confirm copy states the real impact (AC 19/40)', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([connectedGoogle])
    ;(disconnectCalendar as jest.Mock).mockResolvedValue(true)
    renderPanel()

    await screen.findByText('Connected')
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }))

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Google Calendar'))
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Events already in your calendar are left in place'),
    )
    await waitFor(() => {
      expect(disconnectCalendar).toHaveBeenCalledWith('GOOGLE')
    })
    confirmSpy.mockRestore()
  })

  it('does not disconnect when the confirm is dismissed', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([connectedGoogle])
    renderPanel()

    await screen.findByText('Connected')
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }))

    expect(disconnectCalendar).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('starts the connect flow: fetches the authorize URL and stores the provider for the callback', async () => {
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([])
    ;(getCalendarAuthUrl as jest.Mock).mockResolvedValue({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?state=xyz',
      state: 'xyz',
    })
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    })
    renderPanel()

    await screen.findByText('Google Calendar')
    fireEvent.click(screen.getAllByRole('button', { name: /Connect/ })[0]!)

    await waitFor(() => {
      expect(getCalendarAuthUrl).toHaveBeenCalledWith('GOOGLE')
      expect(sessionStorage.getItem('calendar-connect-provider')).toBe('GOOGLE')
      expect(window.location.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=xyz')
    })
    Object.defineProperty(window, 'location', { writable: true, value: originalLocation })
    sessionStorage.clear()
  })

  it('reuses the shared EmptyState and ErrorState primitives', async () => {
    ;(getCalendarConnections as jest.Mock).mockRejectedValue(new Error('boom'))
    renderPanel()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()
  })

  it('shows an error toast when starting the connect flow fails', async () => {
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([])
    ;(getCalendarAuthUrl as jest.Mock).mockRejectedValue(new Error('not configured'))
    renderPanel()

    await screen.findByText('Google Calendar')
    fireEvent.click(screen.getAllByRole('button', { name: /Connect/ })[0]!)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('not configured')
    })
  })

  it('shows an error toast when a sync-now fails', async () => {
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([connectedGoogle])
    ;(syncCalendar as jest.Mock).mockRejectedValue(new Error('sync failed'))
    renderPanel()

    await screen.findByText('Connected')
    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('sync failed')
    })
  })

  it('shows an error toast when the disconnect mutation fails', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    ;(getCalendarConnections as jest.Mock).mockResolvedValue([connectedGoogle])
    ;(disconnectCalendar as jest.Mock).mockRejectedValue(new Error('disconnect failed'))
    renderPanel()

    await screen.findByText('Connected')
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('disconnect failed')
    })
    confirmSpy.mockRestore()
  })
})
