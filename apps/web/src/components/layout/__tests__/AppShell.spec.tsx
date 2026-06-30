import { fireEvent, render, screen, within } from '@testing-library/react'

import { AppShell } from '../AppShell'

const mockPush = jest.fn()
const mockUsePathname = jest.fn(() => '/contacts')

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
    role: 'ADMIN',
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'User',
  }),
)

jest.mock('@/services/user.service', () => ({
  getMe: (): Promise<unknown> => mockGetMe(),
}))

const mockSetUser = jest.fn()
const mockSetLoading = jest.fn()

const mockAuthState = {
  user: { role: 'ADMIN' } as { role: string } | null,
  setUser: mockSetUser,
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
  mockAuthState.user = role ? { role } : null
}

describe('AppShell', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/contacts')
    setAuthRole('ADMIN')
  })

  function getDesktopNavigation(): HTMLElement {
    return screen.getByRole('complementary', { name: 'Desktop CRM navigation' })
  }

  function getTabletRailNavigation(): HTMLElement {
    return screen.getByRole('complementary', { name: 'Tablet CRM navigation' })
  }

  it('renders sidebar navigation, topbar, and main workspace content', () => {
    render(
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
    render(<AppShell>Content</AppShell>)

    const desktopNav = within(getDesktopNavigation())
    const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

    expect(within(desktopLinks).getByText('Command Center')).toBeInTheDocument()
    expect(within(desktopLinks).getByRole('link', { name: 'Contacts' })).toHaveAttribute(
      'href',
      '/contacts',
    )
    expect(within(desktopLinks).getByText('Deals')).toBeInTheDocument()
    expect(within(desktopLinks).getByText('Activities')).toBeInTheDocument()
    expect(within(desktopLinks).getByText('Reports')).toBeInTheDocument()
    expect(within(desktopLinks).getByText('AI Query')).toBeInTheDocument()
    expect(within(desktopLinks).getByText('Users')).toBeInTheDocument()
    expect(within(desktopLinks).getByText('Settings')).toBeInTheDocument()
  })

  it('marks the current route as active in the sidebar', () => {
    render(<AppShell>Content</AppShell>)

    // Both desktop and tablet rail have Contacts link; at least one must have aria-current
    const allContactsLinks = screen.getAllByRole('link', { name: 'Contacts' })
    const activeLink = allContactsLinks.find((link) => link.getAttribute('aria-current') === 'page')
    expect(activeLink).toBeDefined()
  })

  it('renders accessible topbar placeholders', () => {
    render(<AppShell>Content</AppShell>)

    expect(screen.getByRole('searchbox', { name: 'Search or run command' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View notifications' })).toBeInTheDocument()
    // User menu button is always visible
    const menuButtons = screen.getAllByRole('button', { name: 'User menu' })
    expect(menuButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('opens command dialog when topbar search trigger is clicked', () => {
    render(<AppShell>Content</AppShell>)

    const searchbox = screen.getByRole('searchbox', { name: 'Search or run command' })
    fireEvent.click(searchbox)
    // jsdom click does not trigger focus; fire explicitly so onFocus fires
    fireEvent.focus(searchbox)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).queryByText('Command Center')).not.toBeInTheDocument()
    expect(
      within(dialog).queryByPlaceholderText('Search contacts, deals, or actions...'),
    ).not.toBeInTheDocument()
  })

  it('opens mobile navigation and exposes tenant/user context in the collapsed state', () => {
    render(<AppShell>Content</AppShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    const mobileNavigation = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })

    expect(within(mobileNavigation).getByText('Contacts')).toBeInTheDocument()
    expect(within(mobileNavigation).getByLabelText('Current tenant and user')).toHaveTextContent(
      'Workspace',
    )
  })

  it('closes mobile navigation from the collapsed state', () => {
    render(<AppShell>Content</AppShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Close navigation menu' })[1])

    expect(
      screen.queryByRole('complementary', { name: 'Mobile CRM navigation' }),
    ).not.toBeInTheDocument()
  })

  it('renders Command Center as a navigable sidebar link', () => {
    render(<AppShell>Content</AppShell>)

    const desktopNav = within(getDesktopNavigation())
    const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

    expect(within(desktopLinks).getByRole('link', { name: 'Command Center' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    expect(within(desktopLinks).getByRole('link', { name: 'Contacts' })).toHaveAttribute(
      'href',
      '/contacts',
    )
  })

  it('marks Command Center active on the dashboard route', () => {
    mockUsePathname.mockReturnValue('/dashboard')

    render(<AppShell>Content</AppShell>)

    const allCommandCenterLinks = screen.getAllByRole('link', { name: 'Command Center' })
    const activeLink = allCommandCenterLinks.find(
      (link) => link.getAttribute('aria-current') === 'page',
    )
    expect(activeLink).toBeDefined()
    // Contacts should NOT be active
    const allContactsLinks = screen.getAllByRole('link', { name: 'Contacts' })
    allContactsLinks.forEach((link) => {
      expect(link).not.toHaveAttribute('aria-current')
    })
  })

  it('exposes Command Center in mobile navigation', () => {
    mockUsePathname.mockReturnValue('/dashboard')

    render(<AppShell>Content</AppShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    const mobileNavigation = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })

    expect(within(mobileNavigation).getByRole('link', { name: 'Command Center' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })

  // New responsive tests (AC: 9)
  describe('Responsive behavior', () => {
    it('renders tablet rail navigation with compact markers', () => {
      render(<AppShell>Content</AppShell>)

      const tabletRail = getTabletRailNavigation()
      const tabletNav = within(tabletRail).getByRole('navigation', { name: 'CRM navigation' })

      // Tablet rail shows compact navigation items with aria-labels (no visible text)
      expect(within(tabletNav).getByRole('link', { name: 'Command Center' })).toBeInTheDocument()
      expect(within(tabletNav).getByRole('link', { name: 'Contacts' })).toBeInTheDocument()
      expect(within(tabletNav).getByLabelText('Deals coming soon')).toBeInTheDocument()
      expect(within(tabletNav).getByLabelText('Activities coming soon')).toBeInTheDocument()
      expect(within(tabletNav).getByLabelText('Reports coming soon')).toBeInTheDocument()
      expect(within(tabletNav).getByLabelText('AI Query coming soon')).toBeInTheDocument()
      expect(within(tabletNav).getByRole('link', { name: 'Users' })).toBeInTheDocument()
      expect(within(tabletNav).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    })

    it('renders mobile navigation trigger visible below lg', () => {
      render(<AppShell>Content</AppShell>)

      const hamburger = screen.getByRole('button', { name: 'Open navigation menu' })
      expect(hamburger).toBeInTheDocument()
      expect(hamburger).toHaveClass('lg:hidden')
    })

    it('applies aria-hidden to main content when drawer is open', () => {
      render(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      // aria-hidden="true" hides from getByRole; use querySelector instead
      const mainContent = document.querySelector('main[aria-label="CRM workspace"]')
      expect(mainContent).toBeInTheDocument()
      expect(mainContent).toHaveAttribute('aria-hidden', 'true')
    })

    it('closes drawer on Escape key press', () => {
      render(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      const drawer = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })
      expect(drawer).toBeInTheDocument()

      fireEvent.keyDown(drawer, { key: 'Escape' })

      expect(
        screen.queryByRole('complementary', { name: 'Mobile CRM navigation' }),
      ).not.toBeInTheDocument()
    })

    it('closes drawer when a navigation link is clicked', () => {
      render(<AppShell>Content</AppShell>)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

      const drawer = screen.getByRole('complementary', { name: 'Mobile CRM navigation' })
      fireEvent.click(within(drawer).getByRole('link', { name: 'Contacts' }))

      expect(
        screen.queryByRole('complementary', { name: 'Mobile CRM navigation' }),
      ).not.toBeInTheDocument()
    })

    it('closes drawer when backdrop is clicked', () => {
      render(<AppShell>Content</AppShell>)

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
      render(<AppShell>Content</AppShell>)

      const notificationButton = screen.getByRole('button', { name: 'View notifications' })
      expect(notificationButton).toHaveClass('h-11', 'w-11')
    })

    it('renders hamburger button with minimum 44x44px size', () => {
      render(<AppShell>Content</AppShell>)

      const hamburger = screen.getByRole('button', { name: 'Open navigation menu' })
      expect(hamburger).toHaveClass('h-11', 'w-11')
    })

    it('renders sidebar links with minimum 44px height', () => {
      render(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const navLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })
      // Nav links have min-h-11 (44px)
      const contactsLink = within(navLinks).getByRole('link', { name: 'Contacts' })
      expect(contactsLink).toHaveClass('min-h-11')
    })
  })

  // Tenant/user visibility tests (AC: 7)
  describe('Tenant and user visibility', () => {
    it('shows user menu button at all breakpoints', () => {
      render(<AppShell>Content</AppShell>)

      const menuButtons = screen.getAllByRole('button', { name: 'User menu' })
      expect(menuButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('has compact mobile user menu visible below lg', () => {
      render(<AppShell>Content</AppShell>)

      // Below lg, compact badge is visible (lg:hidden class on the mobile container)
      const menuButtons = screen.getAllByRole('button', { name: 'User menu' })
      expect(menuButtons.length).toBeGreaterThan(1)
    })
  })

  // Role-aware navigation tests (AC: 5, 14, 15)
  describe('Role-aware navigation', () => {
    it('shows Users nav item for ADMIN role', () => {
      setAuthRole('ADMIN')
      render(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

      expect(within(desktopLinks).getByText('Users')).toBeInTheDocument()
      expect(within(desktopLinks).getByRole('link', { name: 'Users' })).toHaveAttribute(
        'href',
        '/users',
      )
    })

    it('shows Users nav item for MANAGER role', () => {
      setAuthRole('MANAGER')
      render(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

      expect(within(desktopLinks).getByText('Users')).toBeInTheDocument()
    })

    it('hides Users nav item for SALES_REP role', () => {
      setAuthRole('SALES_REP')
      render(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

      expect(within(desktopLinks).queryByText('Users')).not.toBeInTheDocument()
    })

    it('hides Users nav item when user is null (unauthenticated)', () => {
      setAuthRole(null)
      render(<AppShell>Content</AppShell>)

      const desktopNav = within(getDesktopNavigation())
      const desktopLinks = desktopNav.getByRole('navigation', { name: 'CRM navigation' })

      expect(within(desktopLinks).queryByText('Users')).not.toBeInTheDocument()
    })
  })
})
