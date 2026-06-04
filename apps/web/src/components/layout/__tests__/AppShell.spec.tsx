import { fireEvent, render, screen, within } from '@testing-library/react'

import { AppShell } from '../AppShell'

const mockUsePathname = jest.fn(() => '/contacts')

jest.mock('next/navigation', () => ({
  usePathname: (): string => mockUsePathname(),
}))

describe('AppShell', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/contacts')
  })

  it('renders sidebar navigation, topbar, and main workspace content', () => {
    render(
      <AppShell>
        <section>Workspace content</section>
      </AppShell>,
    )

    expect(screen.getByRole('navigation', { name: 'CRM navigation' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'CRM workspace' })).toHaveTextContent(
      'Workspace content',
    )
  })

  it('shows the MVP sidebar navigation items', () => {
    render(<AppShell>Content</AppShell>)

    const navigation = screen.getByRole('navigation', { name: 'CRM navigation' })

    expect(within(navigation).getByText('Command Center')).toBeInTheDocument()
    expect(within(navigation).getByRole('link', { name: 'Contacts' })).toHaveAttribute(
      'href',
      '/contacts',
    )
    expect(within(navigation).getByText('Deals')).toBeInTheDocument()
    expect(within(navigation).getByText('Activities')).toBeInTheDocument()
    expect(within(navigation).getByText('Reports')).toBeInTheDocument()
    expect(within(navigation).getByText('AI Query')).toBeInTheDocument()
    expect(within(navigation).getByText('Settings')).toBeInTheDocument()
  })

  it('marks the current route as active in the sidebar', () => {
    render(<AppShell>Content</AppShell>)

    expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders accessible topbar placeholders', () => {
    render(<AppShell>Content</AppShell>)

    expect(screen.getByRole('button', { name: 'Search or run command' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View notifications' })).toBeInTheDocument()
    expect(screen.getByLabelText('Current tenant and user')).toBeInTheDocument()
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
})
