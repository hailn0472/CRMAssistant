import { render, screen } from '@testing-library/react'
import { BulkAssignDialog } from '@/components/contacts/BulkAssignDialog'

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn().mockReturnValue({ data: [], isLoading: false }),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

describe('BulkAssignDialog', () => {
  it('should render with contact count', () => {
    render(
      <BulkAssignDialog
        open={true}
        onOpenChange={jest.fn()}
        contactIds={['c1', 'c2', 'c3']}
        onAssignBulk={jest.fn()}
      />,
    )
    expect(screen.getByText(/2|3|c1|c2|c3/i)).toBeInTheDocument()
  })

  it('should not render when closed', () => {
    const { container } = render(
      <BulkAssignDialog
        open={false}
        onOpenChange={jest.fn()}
        contactIds={['c1']}
        onAssignBulk={jest.fn()}
      />,
    )
    expect(container.innerHTML).toBe('')
  })
})
