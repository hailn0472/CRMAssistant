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
    // CRM link and Settings link are present.
    expect(container.querySelectorAll('a')).toHaveLength(2)
  })

  it('labels unknown dynamic segments (record ids) as "Chi tiết"', () => {
    mockUsePathname.mockReturnValue('/contacts/abc-123-xyz')

    render(<Breadcrumbs />)

    expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute('href', '/contacts')
    expect(screen.getByText('Chi tiết')).toBeInTheDocument()
  })

  it('renders a single, non-linked crumb for a top-level route without duplicate key console errors', () => {
    const errorSpy = jest.spyOn(console, 'error')
    mockUsePathname.mockReturnValue('/dashboard')

    render(<Breadcrumbs />)

    expect(screen.getByRole('link', { name: 'CRM' })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByText('Dashboard')).toHaveAttribute('aria-current', 'page')
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
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

  it('labels the sales segment — not "Chi tiết" (Story 6.2, AC 65)', () => {
    mockUsePathname.mockReturnValue('/reports/sales')

    render(<Breadcrumbs />)
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports')
    expect(screen.getByText('Sales')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Chi tiết')).not.toBeInTheDocument()
  })

  it('labels the builder segment — not "Chi tiết" (Story 6.3, D.31)', () => {
    mockUsePathname.mockReturnValue('/reports/builder')

    render(<Breadcrumbs />)
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports')
    expect(screen.getByText('Builder')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Chi tiết')).not.toBeInTheDocument()
  })

  it('labels the schedules segment — not "Chi tiết" (Story 6.5, Contract F.34)', () => {
    mockUsePathname.mockReturnValue('/reports/schedules')

    render(<Breadcrumbs />)
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports')
    expect(screen.getByText('Schedules')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Chi tiết')).not.toBeInTheDocument()
  })

  it('labels the productivity segment instead of the "Chi tiết" fallback (AC #45)', () => {
    mockUsePathname.mockReturnValue('/reports/productivity')

    render(<Breadcrumbs />)
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports')
    expect(screen.getByText('Productivity')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Chi tiết')).not.toBeInTheDocument()
  })

  it('labels the activity segment — not "Chi tiết" (Story 6.8, Contract E25)', () => {
    mockUsePathname.mockReturnValue('/reports/activity')

    render(<Breadcrumbs />)
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports')
    expect(screen.getByText('Activity')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Chi tiết')).not.toBeInTheDocument()
  })
})
