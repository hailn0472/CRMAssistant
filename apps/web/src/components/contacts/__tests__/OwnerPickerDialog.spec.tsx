import { render, screen, fireEvent } from '@testing-library/react'
import { OwnerPickerDialog } from '@/components/contacts/OwnerPickerDialog'

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

import { useQuery } from '@tanstack/react-query'

describe('OwnerPickerDialog', () => {
  it('should render with search input', () => {
    ;(useQuery as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
    })
    render(<OwnerPickerDialog open={true} onOpenChange={jest.fn()} onSelect={jest.fn()} />)
    expect(screen.getByPlaceholderText(/tìm kiếm/i)).toBeInTheDocument()
  })

  it('should show loading state', () => {
    ;(useQuery as jest.Mock).mockReturnValue({
      data: [],
      isLoading: true,
    })
    render(<OwnerPickerDialog open={true} onOpenChange={jest.fn()} onSelect={jest.fn()} />)
    expect(screen.getByText(/đang tải/i)).toBeInTheDocument()
  })

  it('should display users when data is loaded', () => {
    ;(useQuery as jest.Mock).mockReturnValue({
      data: [{ id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@x.com' }],
      isLoading: false,
    })
    render(<OwnerPickerDialog open={true} onOpenChange={jest.fn()} onSelect={jest.fn()} />)
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
  })

  it('should call onSelect when a user is clicked', () => {
    const onSelect = jest.fn()
    ;(useQuery as jest.Mock).mockReturnValue({
      data: [{ id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@x.com' }],
      isLoading: false,
    })
    render(<OwnerPickerDialog open={true} onOpenChange={jest.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Alice Smith'))
    expect(onSelect).toHaveBeenCalledWith('u1')
  })
})
