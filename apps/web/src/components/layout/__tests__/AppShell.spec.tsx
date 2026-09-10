import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AppShell } from '../AppShell'

const mockPush = jest.fn()
const mockUsePathname = jest.fn(() => '/contacts')

global.fetch = jest.fn(() =>
  Promise.resolve({ json: () => Promise.resolve({ wsToken: null }) } as Response),
) as jest.Mock

jest.mock('next/navigation', () => ({
  useRouter: (): { push: jest.Mock } => ({
    push: mockPush,
  }),
  usePathname: (): string => mockUsePathname(),
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
}))

const mockGetMe = jest.fn(() =>
  Promise.resolve({
    id: 'user-1',
    tenantId: 'tenant-1',
    roles: [{ name: 'ADMIN' }],
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'User',
  }),
)

jest.mock('@/services/user.service', () => ({
  getMe: (): Promise<unknown> => mockGetMe(),
}))

jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
    disconnect: jest.fn(),
  })),
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
          data: [
            'CONTACT',
            'DEAL',
            'TASK',
            'TICKET',
            'REPORT',
            'USER',
            'ROLE',
            'SETTINGS',
            'INBOX',
          ].flatMap((r) =>
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
      if (queryKey[0] === 'notifications') {
        return { data: 0, isLoading: false, isError: false }
      }
      return actual.useQuery
    }),
  }
})

const mockSetUser = jest.fn()
const mockSetAccessToken = jest.fn()
const mockSetLoading = jest.fn()

const mockAuthState = {
  user: { roles: ['ADMIN'] } as { roles: string[] } | null,
  setUser: mockSetUser,
  setAccessToken: mockSetAccessToken,
  setLoading: mockSetLoading,
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

function setAuthRole(role: string | null): void {
  mockAuthState.user = role ? { roles: [role] } : null
  // When auth state resolves (user confirmed null), loading is done
  if (!role) {
    mockAuthState.isLoading = false
  }
}

describe('AppShell', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/contacts')
    setAuthRole('ADMIN')
  })

  function renderApp(children: React.ReactNode): ReturnType<typeof render> {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
  }

  function getDesktopNavigation(): HTMLElement {
    return screen.getByRole('complementary', { name: 'Desktop CRM navigation' })
  }

  function getTabletRailNavigation(): HTMLElement {
    return screen.getByRole('complementary', { name: 'Tablet CRM navigation' })
  }

  it('renders sidebar navigation, topbar, and main workspace content', () => {
    renderApp(
      <AppShell>
        <section>Workspace content</section>
      </AppShell>,
    )

    // Both desktop sidebar and tablet rail are rendered in JSDOM (no media queries)
    expect(getDesktopNavigation()).toBeInTheDocument()
    expect(getTabletRailNavigation()).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'CRM workspace' })).toHaveTextContent(
      'Workspace content',
    )
  })

  it('shows the MVP sidebar navigation items', () => {
    renderApp(<AppShell>Content</AppShell>)

    const desktopNav = within(getDesktopNavigation())
    const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

    expect(within(desktopLinks).getByText('Dashboard')).toBeInTheDocument()
    expect(within(desktopLinks).getByRole('link', { name: 'Contacts' })).toHaveAttribute(
      'href',
      '/contacts',
    )
    // Accessible name includes the unread badge, e.g. "Inbox 4"
    expect(within(desktopLinks).getByRole('link', { name: /^Inbox/ })).toHaveAttribute(
      'href',
      '/inbox',
    )
    expect(within(desktopLinks).getByText('Users')).toBeInTheDocument()
    expect(within(desktopLinks).getByText('Settings')).toBeInTheDocument()
  })

  it('marks the current route as active in the sidebar', () => {
    renderApp(<AppShell>Content</AppShell>)

    // Both desktop and tablet rail have Contacts link; at least one must have aria-current
    const allContactsLinks = screen.getAllByRole('link', { name: 'Contacts' })
    const activeLink = allContactsLinks.find((link) => link.getAttribute('aria-current') === 'page')
    expect(activeLink).toBeDefined()
  })

  it('renders accessible topbar placeholders', () => {
    renderApp(<AppShell>Content</AppShell>)

    expect(screen.getByRole('searchbox', { name: 'Search or run command' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View notifications' })).toBeInTheDocument()
    // Identity lives in the sidebar profile menu, not the topbar
    expect(
      within(getDesktopNavigation()).getByRole('button', { name: 'User profile menu' }),
    ).toBeInTheDocument()
  })

  it('opens command dialog when topbar search trigger is clicked', () => {
    renderApp(<AppShell>Content</AppShell>)

    const searchbox = screen.getByRole('searchbox', { name: 'Search or run command' })
    fireEvent.click(searchbox)
    // jsdom click does not trigger focus; fire explicitly so onFocus fires
    fireEvent.focus(searchbox)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).queryByText('Dashboard')).not.toBeInTheDocument()
    expect(
      within(dialog).queryByPlaceholderText('Search contacts, deals, or actions...'),
    ).not.toBeInTheDocument()
  })

  it('opens mobile navigation and exposes tenant/user context in the collapsed state', () => {
    renderApp(<AppShell>Content</AppShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    const mobileNavigation = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })

    expect(within(mobileNavigation).getByText('Contacts')).toBeInTheDocument()
    // Workspace identity in the drawer header + the user profile menu at its foot
    expect(within(mobileNavigation).getByText('CRMAssistant')).toBeInTheDocument()
    expect(
      within(mobileNavigation).getByRole('button', { name: 'User profile menu' }),
    ).toBeInTheDocument()
  })

  it('closes mobile navigation from the collapsed state', () => {
    renderApp(<AppShell>Content</AppShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Close navigation menu' })[1])

    expect(
      screen.queryByRole('complementary', { name: 'Mobile CRM navigation' }),
    ).not.toBeInTheDocument()
  })

  it('renders Dashboard as a navigable sidebar link', () => {
    renderApp(<AppShell>Content</AppShell>)

    const desktopNav = within(getDesktopNavigation())
    const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

    expect(within(desktopLinks).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    expect(within(desktopLinks).getByRole('link', { name: 'Contacts' })).toHaveAttribute(
      'href',
      '/contacts',
    )
  })

  it('marks Dashboard active on the dashboard route', () => {
    mockUsePathname.mockReturnValue('/dashboard')

    renderApp(<AppShell>Content</AppShell>)

    const allDashboardLinks = screen.getAllByRole('link', { name: 'Dashboard' })
    const activeLink = allDashboardLinks.find(
      (link) => link.getAttribute('aria-current') === 'page',
    )
    expect(activeLink).toBeDefined()
    // Contacts should NOT be active
    const allContactsLinks = screen.getAllByRole('link', { name: 'Contacts' })
    allContactsLinks.forEach((link) => {
      expect(link).not.toHaveAttribute('aria-current')
    })
  })

  it('exposes Dashboard in mobile navigation', () => {
    mockUsePathname.mockReturnValue('/dashboard')

    renderApp(<AppShell>Content</AppShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    const mobileNavigation = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })

    expect(within(mobileNavigation).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })

  // New responsive tests (AC: 9)
  describe('Responsive behavior', () => {
    it('renders tablet rail navigation with compact markers', () => {
      renderApp(<AppShell>Content</AppShell>)

      const tabletRail = getTabletRailNavigation()
      const tabletNav = within(tabletRail).getByRole('navigation', { name: 'CRM navigation' })

      // Tablet rail shows compact navigation items with aria-labels (no visible text)
      expect(within(tabletNav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
      expect(within(tabletNav).getByRole('link', { name: 'Contacts' })).toBeInTheDocument()
      expect(within(tabletNav).getByRole('link', { name: 'Inbox' })).toBeInTheDocument()
      expect(within(tabletNav).getByRole('link', { name: 'Users' })).toBeInTheDocument()
      expect(within(tabletNav).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    })

    it('renders mobile navigation trigger visible below lg', () => {
      renderApp(<AppShell>Content</AppShell>)

      const hamburger = screen.getByRole('button', { name: 'Open navigation menu' })
      expect(hamburger).toBeInTheDocument()
      expect(hamburger).toHaveClass('lg:hidden')
    })

    it('applies aria-hidden to main content when drawer is open', () => {
      renderApp(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      // aria-hidden="true" hides from getByRole; use querySelector instead
      const mainContent = document.querySelector('main[aria-label="CRM workspace"]')
      expect(mainContent).toBeInTheDocument()
      expect(mainContent).toHaveAttribute('aria-hidden', 'true')
    })

    it('portals the open mobile overlay to the body for viewport-level positioning', () => {
      renderApp(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      const drawer = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })
      const overlay = drawer.parentElement

      expect(overlay).toHaveClass('fixed', 'inset-0')
      expect(overlay?.parentElement).toBe(document.body)
      expect(drawer).toHaveClass('h-full')
    })

    it('closes drawer on Escape key press', () => {
      renderApp(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      const drawer = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })
      expect(drawer).toBeInTheDocument()

      fireEvent.keyDown(drawer, { key: 'Escape' })

      expect(
        screen.queryByRole('complementary', { name: 'Mobile CRM navigation' }),
      ).not.toBeInTheDocument()
    })

    it('closes drawer when a navigation link is clicked', () => {
      renderApp(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      const drawer = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })
      fireEvent.click(within(drawer).getByRole('link', { name: 'Contacts' }))

      expect(
        screen.queryByRole('complementary', { name: 'Mobile CRM navigation' }),
      ).not.toBeInTheDocument()
    })

    it('closes drawer when backdrop is clicked', () => {
      renderApp(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      // Backdrop is the first "Close navigation menu" button (the overlay)
      const closeButtons = screen.getAllByRole('button', { name: 'Close navigation menu' })
      fireEvent.click(closeButtons[0])

      expect(
        screen.queryByRole('complementary', { name: 'Mobile CRM navigation' }),
      ).not.toBeInTheDocument()
    })
  })

  // Touch target tests (AC: 4, 9)
  describe('Touch targets', () => {
    it('renders notification button with minimum 44x44px size', () => {
      renderApp(<AppShell>Content</AppShell>)

      const notificationButton = screen.getByRole('button', { name: 'View notifications' })
      expect(notificationButton).toHaveClass('h-11', 'w-11')
    })

    it('renders hamburger button with minimum 44x44px size', () => {
      renderApp(<AppShell>Content</AppShell>)

      const hamburger = screen.getByRole('button', { name: 'Open navigation menu' })
      expect(hamburger).toHaveClass('h-11', 'w-11')
    })

    it('renders sidebar links with minimum 44px height', () => {
      renderApp(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const navLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })
      // Nav links have min-h-11 (44px)
      const contactsLink = within(navLinks).getByRole('link', { name: 'Contacts' })
      expect(contactsLink).toHaveClass('min-h-11')
    })
  })

  // Tenant/user visibility tests (AC: 7)
  describe('Tenant and user visibility', () => {
    it('shows the user profile menu in the desktop sidebar', () => {
      renderApp(<AppShell>Content</AppShell>)

      const menuButtons = screen.getAllByRole('button', { name: 'User profile menu' })
      expect(menuButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('exposes the user profile menu below lg through the mobile drawer', () => {
      renderApp(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      const mobileNavigation = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })
      expect(
        within(mobileNavigation).getByRole('button', { name: 'User profile menu' }),
      ).toBeInTheDocument()
      // Desktop sidebar copy + drawer copy
      expect(screen.getAllByRole('button', { name: 'User profile menu' }).length).toBeGreaterThan(1)
    })
  })

  // Role-aware navigation tests (AC: 5, 14, 15)
  describe('Role-aware navigation', () => {
    it('shows Users nav item for ADMIN role', () => {
      setAuthRole('ADMIN')
      renderApp(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

      expect(within(desktopLinks).getByText('Users')).toBeInTheDocument()
      expect(within(desktopLinks).getByRole('link', { name: 'Users' })).toHaveAttribute(
        'href',
        '/users',
      )
    })

    it('shows Users nav item for SALES_MANAGER role', () => {
      setAuthRole('SALES_MANAGER')
      renderApp(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

      expect(within(desktopLinks).getByText('Users')).toBeInTheDocument()
    })

    it('shows Users nav item for SALES_REP role when USER:READ permission is granted', () => {
      setAuthRole('SALES_REP')
      renderApp(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

      // Permission-based gating: if USER:READ is granted, Users nav is visible regardless of role
      expect(within(desktopLinks).getByText('Users')).toBeInTheDocument()
    })

    it('hides Users nav item when user is null (unauthenticated)', () => {
      setAuthRole(null)
      renderApp(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

      expect(within(desktopLinks).queryByText('Users')).not.toBeInTheDocument()
    })
  })
})
