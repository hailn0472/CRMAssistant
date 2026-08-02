import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import SettingsLayout from '../layout'
import { getMyPermissions } from '@/services/permission.service'

const mockUsePathname = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: (): string => mockUsePathname(),
}))

jest.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { roles: ['ADMIN'] }, isAuthenticated: true }),
}))

jest.mock('@/services/permission.service', () => ({
  getMyPermissions: jest.fn(),
}))

function renderLayout(): ReturnType<typeof render> {
  ;(getMyPermissions as jest.Mock).mockResolvedValue([])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsLayout>
        <div>page content</div>
      </SettingsLayout>
    </QueryClientProvider>,
  )
}

describe('SettingsLayout nav', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/settings/reminders')
    jest.clearAllMocks()
  })

  it('shows the Reminders nav item for every user — no roles, no permission (AC 54)', () => {
    renderLayout()

    const link = screen.getByRole('link', { name: 'Reminders' })
    expect(link).toHaveAttribute('href', '/settings/reminders')
  })

  it('marks the Reminders item active on the reminders page', () => {
    mockUsePathname.mockReturnValue('/settings/reminders')
    renderLayout()

    expect(screen.getByRole('link', { name: 'Reminders' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows the Calendars nav item for every user — no roles, no permission (Story 4.3 AC 42)', () => {
    renderLayout()

    const link = screen.getByRole('link', { name: 'Calendars' })
    expect(link).toHaveAttribute('href', '/settings/calendars')
  })
})
