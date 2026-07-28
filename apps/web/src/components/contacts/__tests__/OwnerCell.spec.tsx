import { render, screen } from '@testing-library/react'
import { OwnerCell } from '@/components/contacts/OwnerCell'

describe('OwnerCell', () => {
  it('should render owner name when owner data is provided', () => {
    render(
      <OwnerCell
        ownerId="u1"
        owner={{ id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@x.com', avatar: null }}
      />,
    )
    expect(screen.getByText('AS')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
  })

  it('should show Unassigned badge when owner is null', () => {
    render(<OwnerCell ownerId="system" owner={null} />)
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('should render avatar when avatar URL is provided', () => {
    render(
      <OwnerCell
        ownerId="u1"
        owner={{ id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@x.com', avatar: 'https://example.com/avatar.png' }}
      />,
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.png')
  })
})
