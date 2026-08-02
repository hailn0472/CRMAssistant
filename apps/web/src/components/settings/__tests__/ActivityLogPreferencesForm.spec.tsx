import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { ActivityLogPreferencesForm } from '../ActivityLogPreferencesForm'
import SettingsLayout from '@/app/(dashboard)/settings/layout'
import {
  getMyActivityLogPreferences,
  updateActivityLogPreferences,
} from '@/services/activity.service'

jest.mock('@/services/activity.service', () => ({
  getMyActivityLogPreferences: jest.fn(),
  updateActivityLogPreferences: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

// For the settings-nav test below: a null user exercises the ungated path.
jest.mock('@/stores/auth.store', () => ({
  useAuthStore: jest.fn((selector?: (state: unknown) => unknown) =>
    selector?.({ user: null, isLoading: false }),
  ),
}))

const mockUsePathname = jest.fn(() => '/settings/activity-logging')

jest.mock('next/navigation', () => ({
  usePathname: (): string => mockUsePathname(),
}))

const defaultPrefs = {
  logTaskCompleted: true,
  logDealCreated: true,
  logDealStageChanged: true,
  logMessageSent: true,
  logMessageReceived: true,
  // Story 4.3 (AC 8/47).
  logMeetingScheduled: true,
}

function renderForm(
  queryClient?: QueryClient,
  prefs?: typeof defaultPrefs,
): ReturnType<typeof render> {
  if (prefs) {
    // Override the beforeEach default for this render only.
    ;(getMyActivityLogPreferences as jest.Mock).mockResolvedValue(prefs)
  }
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ActivityLogPreferencesForm />
    </QueryClientProvider>,
  )
}

describe('ActivityLogPreferencesForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // TanStack Query v5 treats a queryFn resolving to undefined as an error,
    // so every test gets a concrete default unless it overrides it.
    ;(getMyActivityLogPreferences as jest.Mock).mockResolvedValue(defaultPrefs)
  })

  it('loads and displays the current preferences as toggle state (AC 51 / W18)', async () => {
    renderForm()

    expect(await screen.findByLabelText('Log task completions')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByLabelText('Log deal creation')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Log deal stage changes')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Log sent messages')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Log received messages')).toHaveAttribute('aria-checked', 'true')
    // Story 4.3 (AC 8): the MEETING_SCHEDULED toggle ships with the form.
    expect(screen.getByLabelText('Log scheduled meetings')).toHaveAttribute('aria-checked', 'true')
  })

  it('reflects persisted off-values in the toggles (W18)', async () => {
    renderForm(undefined, { ...defaultPrefs, logTaskCompleted: false })

    expect(await screen.findByLabelText('Log task completions')).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('toggles flip state on click (W19)', async () => {
    renderForm()

    const toggle = await screen.findByLabelText('Log task completions')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('exposes and persists the logMeetingScheduled toggle (Story 4.3 AC 8/47)', async () => {
    ;(updateActivityLogPreferences as jest.Mock).mockResolvedValue({
      ...defaultPrefs,
      logMeetingScheduled: false,
    })
    renderForm()

    const toggle = await screen.findByLabelText('Log scheduled meetings')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(updateActivityLogPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ logMeetingScheduled: false }),
      )
    })
  })

  it('submits the changed payload and shows an impact-stating success toast (AC 51 / W20)', async () => {
    ;(updateActivityLogPreferences as jest.Mock).mockResolvedValue({
      ...defaultPrefs,
      logTaskCompleted: false,
      logMessageReceived: false,
    })
    renderForm()

    fireEvent.click(await screen.findByLabelText('Log task completions'))
    fireEvent.click(screen.getByLabelText('Log received messages'))
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(updateActivityLogPreferences).toHaveBeenCalledWith({
        logTaskCompleted: false,
        logDealCreated: true,
        logDealStageChanged: true,
        logMessageSent: true,
        logMessageReceived: false,
        logMeetingScheduled: true,
      })
    })
    // Success copy states impact, not just "Saved".
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('2 of 6 logging rules turned off'),
    )
  })

  it('shows an all-enabled success message when nothing is turned off (W20)', async () => {
    ;(updateActivityLogPreferences as jest.Mock).mockResolvedValue(defaultPrefs)
    renderForm()

    await screen.findByLabelText('Log task completions')
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('All activity logging enabled'),
      )
    })
  })

  it('invalidates the query cache after a successful submit (W21)', async () => {
    ;(updateActivityLogPreferences as jest.Mock).mockResolvedValue(defaultPrefs)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
    renderForm(queryClient)

    await screen.findByLabelText('Log task completions')
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['myActivityLogPreferences'],
      })
    })
  })

  it('shows an error toast when the save fails (W20 error path)', async () => {
    ;(updateActivityLogPreferences as jest.Mock).mockRejectedValue(new Error('Save failed'))
    renderForm()

    await screen.findByLabelText('Log task completions')
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Save failed')
    })
  })

  it('renders FormSkeleton while loading (AC 54 / W22)', async () => {
    let resolveQuery: (value: typeof defaultPrefs) => void = () => {}
    ;(getMyActivityLogPreferences as jest.Mock).mockReturnValue(
      new Promise<typeof defaultPrefs>((resolve) => {
        resolveQuery = resolve
      }),
    )
    renderForm()

    // Skeleton is present while the query is pending.
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)

    resolveQuery(defaultPrefs)
    expect(await screen.findByLabelText('Log task completions')).toBeInTheDocument()
  })

  it('renders ErrorState with a retry action on query failure (AC 54 / W23)', async () => {
    ;(getMyActivityLogPreferences as jest.Mock).mockRejectedValue(new Error('boom'))
    renderForm()

    expect(
      await screen.findByText('Could not load activity logging preferences'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('reuses the shared FormSkeleton / ErrorState primitives (W24)', async () => {
    ;(getMyActivityLogPreferences as jest.Mock).mockRejectedValue(new Error('boom'))
    renderForm()

    // The error UI is the shared ErrorState component (role="alert" + shared copy).
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('submits only valid boolean values per the Zod schema (W25)', async () => {
    ;(updateActivityLogPreferences as jest.Mock).mockResolvedValue(defaultPrefs)
    renderForm()

    await screen.findByLabelText('Log task completions')
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      const payload = (updateActivityLogPreferences as jest.Mock).mock.calls[0]![0]
      for (const value of Object.values(payload)) {
        expect(typeof value).toBe('boolean')
      }
    })
  })

  it('is accessible to a non-ADMIN user — no permission gating on the form (AC 38 / W26)', async () => {
    renderForm()

    expect(await screen.findByLabelText('Log task completions')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Log deal creation'))
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    await waitFor(() => {
      expect(updateActivityLogPreferences).toHaveBeenCalled()
    })
  })
})

describe('Settings navigation entry (AC 52 / W27, W28)', () => {
  it('exposes an ungated Activity Logging entry next to Reminders', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsLayout>
          <div />
        </SettingsLayout>
      </QueryClientProvider>,
    )

    const link = await screen.findByRole('link', { name: 'Activity Logging' })
    expect(link).toHaveAttribute('href', '/settings/activity-logging')
    // No roles/permission gating: it renders even with a null user (see above).
    expect(screen.getByRole('link', { name: 'Reminders' })).toBeInTheDocument()
  })

  it('exposes an ungated Calendars entry next to Activity Logging (Story 4.3 AC 42)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsLayout>
          <div />
        </SettingsLayout>
      </QueryClientProvider>,
    )

    const link = await screen.findByRole('link', { name: 'Calendars' })
    expect(link).toHaveAttribute('href', '/settings/calendars')
    // No roles and no permission — every user manages their own calendars (AC 32).
    expect(screen.getByRole('link', { name: 'Activity Logging' })).toBeInTheDocument()
  })
})
