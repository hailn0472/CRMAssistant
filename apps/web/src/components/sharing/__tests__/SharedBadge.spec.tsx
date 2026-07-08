import { render, screen } from '@testing-library/react'
import { SharedBadge } from '../SharedBadge'

describe('SharedBadge', () => {
  it('renders badge when visible is true', () => {
    render(<SharedBadge visible={true} />)
    expect(screen.getByText('Shared')).toBeInTheDocument()
  })

  it('does not render when visible is false', () => {
    const { container } = render(<SharedBadge visible={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('has correct styling classes', () => {
    render(<SharedBadge visible={true} />)
    const badge = screen.getByText('Shared')
    expect(badge.className).toContain('rounded-full')
    expect(badge.className).toContain('bg-blue-100')
    expect(badge.className).toContain('text-blue-700')
  })
})
