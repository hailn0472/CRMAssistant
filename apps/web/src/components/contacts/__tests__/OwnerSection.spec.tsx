import { render, screen } from '@testing-library/react'
import { OwnerSection } from '@/components/contacts/OwnerSection'

jest.mock('@/components/contacts/OwnerPickerDialog', () => ({
  OwnerPickerDialog: () => <div data-testid="mock-picker" />,
}))

describe('OwnerSection', () => {
  const defaultProps = {
    contactId: 'c1',
    ownerId: 'u1',
    owner: { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@x.com', avatar: null },
    canUpdate: true,
    onAssignOwner: jest.fn(),
  }

  it('should render owner name', () => {
    render(<OwnerSection {...defaultProps} />)
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
  })

  it('should show Unassigned when no owner', () => {
    render(<OwnerSection {...defaultProps} owner={null} />)
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('should show edit button when canUpdate is true', () => {
    render(<OwnerSection {...defaultProps} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should not show edit button when canUpdate is false', () => {
    render(<OwnerSection {...defaultProps} canUpdate={false} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
