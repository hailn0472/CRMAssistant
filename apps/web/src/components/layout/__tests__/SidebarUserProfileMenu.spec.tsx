import { fireEvent, render, screen } from '@testing-library/react'

import { SidebarUserProfileMenu } from '../AppShellNavigation'

const mockLogout = jest.fn().mockResolvedValue(undefined)

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ logout: mockLogout }),
}))

let mockAuthState: {
  user: {
    roles: string[]
    firstName: string
    lastName: string
    email: string
    avatar?: string | null
  } | null
} = { user: null }

jest.mock('@/stores/auth.store', () => ({
  useAuthStore: jest.fn((selector?: (state: unknown) => unknown) => {
    if (selector) {
      return selector(mockAuthState)
    }
    return mockAuthState
  }),
}))

function setAuthRole(role: string | null): void {
  mockAuthState = role
    ? {
        user: {
          roles: [role],
          firstName: 'Test',
          lastName: 'User',
          email: 'test.user@example.com',
        },
      }
    : { user: null }
}

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'User profile menu' }))
}

describe('SidebarUserProfileMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setAuthRole('ADMIN')
  })

  it('renders the user name and email in the sidebar trigger', () => {
    render(<SidebarUserProfileMenu />)

    const trigger = screen.getByRole('button', { name: 'User profile menu' })
    expect(trigger).toHaveTextContent('Test User')
    expect(trigger).toHaveTextContent('test.user@example.com')
  })

  it('renders role badge for ADMIN', () => {
    setAuthRole('ADMIN')
    render(<SidebarUserProfileMenu />)
    openMenu()

    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('renders role badge for SALES_MANAGER', () => {
    setAuthRole('SALES_MANAGER')
    render(<SidebarUserProfileMenu />)
    openMenu()

    expect(screen.getByText('Sales Manager')).toBeInTheDocument()
  })

  it('renders role badge for SALES_REP', () => {
    setAuthRole('SALES_REP')
    render(<SidebarUserProfileMenu />)
    openMenu()

    expect(screen.getByText('Sales Rep')).toBeInTheDocument()
  })

  it('does not render a role badge when user is null', () => {
    setAuthRole(null)
    render(<SidebarUserProfileMenu />)
    openMenu()

    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    expect(screen.queryByText('Sales Manager')).not.toBeInTheDocument()
    expect(screen.queryByText('Sales Rep')).not.toBeInTheDocument()
  })

  it('shows dropdown with settings link and sign out button on click', () => {
    render(<SidebarUserProfileMenu />)

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()

    openMenu()

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('calls logout when sign out is clicked', () => {
    render(<SidebarUserProfileMenu />)
    openMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(mockLogout).toHaveBeenCalled()
  })

  it('closes the dropdown on Escape', () => {
    render(<SidebarUserProfileMenu />)
    openMenu()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})
