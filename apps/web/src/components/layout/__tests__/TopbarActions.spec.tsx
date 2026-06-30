import { render, screen, fireEvent } from '@testing-library/react'

import { TopbarActions } from '../TopbarActions'

const mockLogout = jest.fn().mockResolvedValue(undefined)

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ logout: mockLogout }),
}))

let mockAuthState: {
  user: { role: string; firstName: string; lastName: string; avatar?: string | null } | null
} = {
  user: { role: 'ADMIN', firstName: 'System', lastName: 'Admin' },
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
  mockAuthState = role ? { user: { role, firstName: 'Test', lastName: 'User' } } : { user: null }
}

describe('TopbarActions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setAuthRole('ADMIN')
  })

  it('renders notification button', () => {
    render(<TopbarActions />)

    expect(screen.getByRole('button', { name: 'View notifications' })).toBeInTheDocument()
  })

  it('renders role badge for ADMIN', () => {
    setAuthRole('ADMIN')
    render(<TopbarActions />)

    expect(screen.getAllByText('Admin').length).toBeGreaterThanOrEqual(1)
  })

  it('renders role badge for MANAGER', () => {
    setAuthRole('MANAGER')
    render(<TopbarActions />)

    expect(screen.getAllByText('Manager').length).toBeGreaterThanOrEqual(1)
  })

  it('renders role badge for SALES_REP', () => {
    setAuthRole('SALES_REP')
    render(<TopbarActions />)

    expect(screen.getAllByText('Sales Rep').length).toBeGreaterThanOrEqual(1)
  })

  it('does not render role badge when user is null', () => {
    setAuthRole(null)
    render(<TopbarActions />)

    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    expect(screen.queryByText('Manager')).not.toBeInTheDocument()
    expect(screen.queryByText('Sales Rep')).not.toBeInTheDocument()
  })

  it('renders user menu buttons', () => {
    render(<TopbarActions />)

    const menuButtons = screen.getAllByRole('button', { name: 'User menu' })
    expect(menuButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders user name in desktop badge', () => {
    render(<TopbarActions />)

    expect(screen.getAllByText('Test User').length).toBeGreaterThanOrEqual(1)
  })

  it('shows dropdown with sign out button on click', () => {
    render(<TopbarActions />)

    const menuButtons = screen.getAllByRole('button', { name: 'User menu' })
    fireEvent.click(menuButtons[0])

    const signOutButton = screen.getByRole('button', { name: 'Sign out' })
    expect(signOutButton).toBeInTheDocument()
  })

  it('calls logout when sign out is clicked', () => {
    render(<TopbarActions />)

    const menuButtons = screen.getAllByRole('button', { name: 'User menu' })
    fireEvent.click(menuButtons[0])

    const signOutButton = screen.getByRole('button', { name: 'Sign out' })
    fireEvent.click(signOutButton)

    expect(mockLogout).toHaveBeenCalled()
  })
})
