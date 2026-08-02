import { render, screen } from '@testing-library/react'

import { Breadcrumbs } from '../Breadcrumbs'

const mockUsePathname = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: (): string => mockUsePathname(),
}))

describe('Breadcrumbs', () => {
  it('links parent segments and renders the last segment as the current page', () => {
    mockUsePathname.mockReturnValue('/settings/channels')

    const { container } = render(<Breadcrumbs />)

    const settingsLink = screen.getByRole('link', { name: 'Settings' })
    expect(settingsLink.tagName).toBe('A')
    expect(settingsLink).toHaveAttribute('href', '/settings')
    // The final crumb is the current page (aria-current), not a navigable anchor.
    expect(screen.getByText('Channels')).toHaveAttribute('aria-current', 'page')
    // Exactly one real anchor (Settings); the current page is a span.
    expect(container.querySelectorAll('a')).toHaveLength(1)
  })

  it('labels unknown dynamic segments (record ids) as "Chi tiết"', () => {
    mockUsePathname.mockReturnValue('/contacts/abc-123-xyz')

    render(<Breadcrumbs />)

    expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute('href', '/contacts')
    expect(screen.getByText('Chi tiết')).toBeInTheDocument()
  })

  it('renders a single, non-linked crumb for a top-level route', () => {
    mockUsePathname.mockReturnValue('/dashboard')

    const { container } = render(<Breadcrumbs />)

    expect(screen.getByText('Dashboard')).toHaveAttribute('aria-current', 'page')
    // No navigable anchors when there is only the current page.
    expect(container.querySelector('a')).toBeNull()
  })

  it('renders nothing at the app root', () => {
    mockUsePathname.mockReturnValue('/')

    const { container } = render(<Breadcrumbs />)

    expect(container).toBeEmptyDOMElement()
  })

  it('labels the competitors segment (AC #29)', () => {
    mockUsePathname.mockReturnValue('/deals/competitors')

    render(<Breadcrumbs />)

    expect(screen.getByRole('link', { name: 'Deals' })).toHaveAttribute('href', '/deals')
    expect(screen.getByText('Competitors')).toHaveAttribute('aria-current', 'page')
  })

  it('labels the win-loss segment (AC #31)', () => {
    mockUsePathname.mockReturnValue('/reports/win-loss')

    render(<Breadcrumbs />)
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports')
    expect(screen.getByText('Win/Loss')).toHaveAttribute('aria-current', 'page')
  })

  it('labels the reminders segment (AC #54)', () => {
    mockUsePathname.mockReturnValue('/settings/reminders')

    render(<Breadcrumbs />)
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.getByText('Reminders')).toHaveAttribute('aria-current', 'page')
  })
})
