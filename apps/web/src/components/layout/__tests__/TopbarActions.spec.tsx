import { render, screen } from '@testing-library/react'

import { TopbarActions } from '../TopbarActions'

// The topbar keeps only ambient status + notifications; identity (role badge,
// user name, sign out) now lives in SidebarUserProfileMenu — see
// __tests__/SidebarUserProfileMenu.spec.tsx.
describe('TopbarActions', () => {
  it('renders notification button', () => {
    render(<TopbarActions />)

    expect(screen.getByRole('button', { name: 'View notifications' })).toBeInTheDocument()
  })

  it('keeps the notification button at the 44x44px touch target', () => {
    render(<TopbarActions />)

    expect(screen.getByRole('button', { name: 'View notifications' })).toHaveClass('h-11', 'w-11')
  })

  it('renders the system status pill', () => {
    render(<TopbarActions />)

    expect(screen.getByText('All systems normal')).toBeInTheDocument()
  })

  it('does not render identity controls (moved to the sidebar profile menu)', () => {
    render(<TopbarActions />)

    expect(screen.queryByRole('button', { name: 'User menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'User profile menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})
