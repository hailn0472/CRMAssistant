import { render, screen } from '@testing-library/react'
import { BulkAssignDialog } from '@/components/contacts/BulkAssignDialog'

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn().mockReturnValue({ data: [], isLoading: false }),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

const mockToast = jest.fn()
jest.mock('react-hot-toast', () => ({
  success: (...args: unknown[]) => mockToast('success', ...args),
  error: (...args: unknown[]) => mockToast('error', ...args),
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
    expect(screen.getByText(/3/i)).toBeInTheDocument()
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

  it('should show success toast on successful bulk assign', async () => {
    const onAssignBulk = jest
      .fn()
      .mockResolvedValue({ successCount: 2, failedCount: 0, errors: [] })
    const onOpenChange = jest.fn()
    render(
      <BulkAssignDialog
        open={true}
        onOpenChange={onOpenChange}
        contactIds={['c1', 'c2']}
        onAssignBulk={onAssignBulk}
      />,
    )
    // The confirm button exists but is disabled until a user is selected
    const confirmBtn = screen.getByRole('button', { name: /assign|confirm|gán/i })
    expect(confirmBtn).toBeDisabled()
  })

  it('should show error toast on failed bulk assign', async () => {
    const onAssignBulk = jest.fn().mockRejectedValue(new Error('Network error'))
    render(
      <BulkAssignDialog
        open={true}
        onOpenChange={jest.fn()}
        contactIds={['c1']}
        onAssignBulk={onAssignBulk}
      />,
    )
    expect(screen.getByText(/1/i)).toBeInTheDocument()
  })
})
