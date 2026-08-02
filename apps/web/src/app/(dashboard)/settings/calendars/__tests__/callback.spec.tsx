import { render, screen, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'

import CalendarCallbackPage from '../callback/page'
import { connectCalendar } from '@/services/calendar.service'

jest.mock('react-hot-toast', () => {
  const fn = jest.fn((message: string) => message)
  ;(fn as unknown as Record<string, unknown>).success = jest.fn()
  ;(fn as unknown as Record<string, unknown>).error = jest.fn()
  return fn
})

jest.mock('@/services/calendar.service', () => ({
  connectCalendar: jest.fn(),
}))

const mockReplace = jest.fn()
let mockParams: Record<string, string | null> = {}

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockParams[key] ?? null,
  }),
  useRouter: () => ({ replace: mockReplace }),
}))

describe('Calendar callback page (Story 4.3 AC 41)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockParams = {}
    sessionStorage.clear()
  })

  it('reads ?code/?state, calls connectCalendar and redirects back with an impact toast', async () => {
    mockParams = { code: 'auth-code-1', state: 'state-1' }
    sessionStorage.setItem('calendar-connect-provider', 'GOOGLE')
    ;(connectCalendar as jest.Mock).mockResolvedValue({ id: 'conn-1', provider: 'GOOGLE' })

    render(<CalendarCallbackPage />)

    await waitFor(() => {
      expect(connectCalendar).toHaveBeenCalledWith({
        provider: 'GOOGLE',
        authCode: 'auth-code-1',
        state: 'state-1',
      })
      expect(mockReplace).toHaveBeenCalledWith('/settings/calendars')
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Google Calendar connected'),
      )
    })
    // The stored provider is cleaned up after the flow completes.
    expect(sessionStorage.getItem('calendar-connect-provider')).toBeNull()
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
  })

  it('handles ?error=access_denied as a normal, non-scary message', async () => {
    mockParams = { error: 'access_denied' }

    render(<CalendarCallbackPage />)

    await waitFor(() => {
      expect(connectCalendar).not.toHaveBeenCalled()
      expect(mockReplace).toHaveBeenCalledWith('/settings/calendars')
    })
    // Calm copy — not an error boundary.
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('nothing was changed'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('handles a generic ?error gracefully', async () => {
    mockParams = { error: 'server_error' }

    render(<CalendarCallbackPage />)

    await waitFor(() => {
      expect(connectCalendar).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('please try again'))
      expect(mockReplace).toHaveBeenCalledWith('/settings/calendars')
    })
  })

  it('handles a missing state gracefully without calling connectCalendar', async () => {
    mockParams = { code: 'auth-code-1' }
    sessionStorage.setItem('calendar-connect-provider', 'GOOGLE')

    render(<CalendarCallbackPage />)

    await waitFor(() => {
      expect(connectCalendar).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('could not be completed'))
      expect(mockReplace).toHaveBeenCalledWith('/settings/calendars')
    })
  })

  it('handles a missing stored provider (expired flow) gracefully', async () => {
    mockParams = { code: 'auth-code-1', state: 'state-1' }

    render(<CalendarCallbackPage />)

    await waitFor(() => {
      expect(connectCalendar).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('expired'))
      expect(mockReplace).toHaveBeenCalledWith('/settings/calendars')
    })
  })

  it('shows the error message from a failed connect and still redirects', async () => {
    mockParams = { code: 'auth-code-1', state: 'state-1' }
    sessionStorage.setItem('calendar-connect-provider', 'OUTLOOK')
    ;(connectCalendar as jest.Mock).mockRejectedValue(new Error('invalid_grant'))

    render(<CalendarCallbackPage />)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('invalid_grant')
      expect(mockReplace).toHaveBeenCalledWith('/settings/calendars')
    })
  })
})
