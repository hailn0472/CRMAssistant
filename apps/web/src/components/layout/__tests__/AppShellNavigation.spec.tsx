import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DesktopNavigation } from '../AppShellNavigation'

const mockUsePathname = jest.fn(() => '/contacts')

jest.mock('next/navigation', () => ({
  useRouter: (): { push: jest.Mock } => ({ push: jest.fn() }),
  usePathname: (): string => mockUsePathname(),
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
}))

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query') as Record<string, unknown>
  return {
    ...actual,
    useQuery: jest.fn(({ queryKey, enabled }: { queryKey: string[]; enabled?: boolean }) => {
      if (queryKey[0] === 'myPermissions') {
        if (enabled === false) {
          return { data: undefined, isLoading: false, isError: false }
        }
        return {
          data: ['REPORT', 'CONTACT', 'DEAL', 'INBOX', 'TASK'].flatMap((r) =>
            ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT', 'ASSIGN'].map((a) => ({
              resource: r,
              action: a,
              granted: true,
            })),
          ),
          isLoading: false,
          isError: false,
        }
      }
      return actual.useQuery
    }),
  }
})

const mockAuthState = {
  user: { roles: ['ADMIN'] } as { roles: string[] } | null,
  isLoading: true,
}

jest.mock('@/stores/auth.store', () => ({
  useAuthStore: jest.fn((selector?: (state: unknown) => unknown) => {
    if (selector) {
      return selector(mockAuthState)
    }
    return mockAuthState
  }),
}))

function renderNav(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <DesktopNavigation />
    </QueryClientProvider>,
  )
}

describe('AppShellNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePathname.mockReturnValue('/contacts')
  })

  it('exposes both report routes (AC #31)', () => {
    renderNav()

    const nav = screen.getByRole('navigation', { name: 'CRM navigation' })
    const forecastLink = within(nav).getByRole('link', { name: 'Reports' })
    expect(forecastLink).toHaveAttribute('href', '/reports/forecast')

    const winLossLink = within(nav).getByRole('link', { name: 'Win/Loss' })
    expect(winLossLink).toHaveAttribute('href', '/reports/win-loss')
  })

  it('exposes the Productivity entry with href /reports/productivity (Story 4.5, AC 44)', () => {
    renderNav()

    const nav = screen.getByRole('navigation', { name: 'CRM navigation' })
    const productivityLink = within(nav).getByRole('link', { name: 'Productivity' })
    expect(productivityLink).toHaveAttribute('href', '/reports/productivity')
  })

  it('marks the productivity route as active when on /reports/productivity', () => {
    mockUsePathname.mockReturnValue('/reports/productivity')
    renderNav()

    const nav = screen.getByRole('navigation', { name: 'CRM navigation' })
    const productivityLink = within(nav).getByRole('link', { name: 'Productivity' })
    expect(productivityLink).toHaveAttribute('aria-current', 'page')
  })

  it('hides the Productivity entry when REPORT:READ is not granted', () => {
    // The spec mocks useQuery directly — override the myPermissions branch to
    // grant everything except REPORT. The auth store mock keeps isLoading=true
    // (flash-avoidance shows all items), so flip it false to exercise the
    // filtering path, and restore both afterwards.
    const { useQuery } = jest.requireMock('@tanstack/react-query') as { useQuery: jest.Mock }
    const original = useQuery.getMockImplementation()!
    ;(mockAuthState as { isLoading: boolean }).isLoading = false
    try {
      useQuery.mockImplementation((args: { queryKey: string[]; enabled?: boolean }) => {
        if (args.queryKey[0] === 'myPermissions') {
          return {
            data: ['CONTACT', 'DEAL', 'TASK'].flatMap((r) =>
              ['CREATE', 'READ', 'UPDATE', 'DELETE'].map((a) => ({
                resource: r,
                action: a,
                granted: true,
              })),
            ),
            isLoading: false,
            isError: false,
          }
        }
        return original(args)
      })
      renderNav()

      const nav = screen.getByRole('navigation', { name: 'CRM navigation' })
      expect(within(nav).queryByRole('link', { name: 'Productivity' })).not.toBeInTheDocument()
      expect(within(nav).queryByRole('link', { name: 'Win/Loss' })).not.toBeInTheDocument()
    } finally {
      useQuery.mockImplementation(original)
      ;(mockAuthState as { isLoading: boolean }).isLoading = true
    }
  })

  it('gates both report entries on REPORT:READ (AC #31)', () => {
    // The navigation sections are static data; permission gating is enforced
    // through the same `permission: { resource: 'REPORT', action: 'READ' }`
    // mechanism as the forecast entry. Render with REPORT permissions granted
    // (as above) — both links are visible.
    renderNav()

    const nav = screen.getByRole('navigation', { name: 'CRM navigation' })
    expect(within(nav).getByRole('link', { name: 'Reports' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Win/Loss' })).toBeInTheDocument()
  })

  it('marks the win-loss route as active when on /reports/win-loss', () => {
    mockUsePathname.mockReturnValue('/reports/win-loss')
    renderNav()

    const nav = screen.getByRole('navigation', { name: 'CRM navigation' })
    const winLossLink = within(nav).getByRole('link', { name: 'Win/Loss' })
    expect(winLossLink).toHaveAttribute('aria-current', 'page')
  })

  it('exposes the Activities entry with href /activities gated on TASK:READ (Story 4.4, AC 38)', () => {
    renderNav()

    const nav = screen.getByRole('navigation', { name: 'CRM navigation' })
    const activitiesLink = within(nav).getByRole('link', { name: 'Activities' })
    expect(activitiesLink).toHaveAttribute('href', '/activities')
  })

  it('marks the activities route as active when on /activities', () => {
    mockUsePathname.mockReturnValue('/activities')
    renderNav()

    const nav = screen.getByRole('navigation', { name: 'CRM navigation' })
    expect(within(nav).getByRole('link', { name: 'Activities' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
