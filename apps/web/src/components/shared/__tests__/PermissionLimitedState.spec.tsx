import { render, screen } from '@testing-library/react'

import { PermissionLimitedState } from '../PermissionLimitedState'

describe('PermissionLimitedState', () => {
  it('renders default title when no title prop is passed', () => {
    render(<PermissionLimitedState message="You do not have permission to view this data." />)

    expect(screen.getByText('Access limited')).toBeInTheDocument()
    expect(screen.getByText('You do not have permission to view this data.')).toBeInTheDocument()
  })

  it('renders custom message and does not contain data counts', () => {
    render(
      <PermissionLimitedState
        title="Restricted area"
        message="Sales reports are only visible to Sales Managers and above."
      />,
    )

    expect(screen.getByText('Restricted area')).toBeInTheDocument()
    expect(
      screen.getByText('Sales reports are only visible to Sales Managers and above.'),
    ).toBeInTheDocument()

    // Must NOT leak data counts (e.g., "3 hidden records")
    expect(screen.queryByText(/\d+ hidden/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ record/i)).not.toBeInTheDocument()
  })

  it('renders actions slot when provided', () => {
    render(
      <PermissionLimitedState
        message="You need additional permissions."
        actions={<button type="button">Request access</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
  })

  it('maps requiredPermission to a safe label and does not leak raw permission names', () => {
    render(
      <PermissionLimitedState
        message="You need additional permissions."
        requiredPermission="contacts:read"
      />,
    )

    expect(screen.getByText(/required access/i)).toBeInTheDocument()
    expect(screen.getByText('View contacts')).toBeInTheDocument()
    expect(screen.queryByText('contacts:read')).not.toBeInTheDocument()
  })
})
