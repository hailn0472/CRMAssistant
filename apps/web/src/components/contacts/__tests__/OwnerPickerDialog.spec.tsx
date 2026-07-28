import { render, screen } from '@testing-library/react'
import { OwnerPickerDialog } from '@/components/contacts/OwnerPickerDialog'

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn().mockReturnValue({ data: [], isLoading: false }),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

describe('OwnerPickerDialog', () => {
  it('should render when open', () => {
    render(<OwnerPickerDialog open={true} onOpenChange={jest.fn()} onSelect={jest.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('should not render when closed', () => {
    const { container } = render(
      <OwnerPickerDialog open={false} onOpenChange={jest.fn()} onSelect={jest.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
