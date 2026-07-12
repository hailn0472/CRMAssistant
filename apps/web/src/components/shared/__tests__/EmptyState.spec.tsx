import { render, screen } from '@testing-library/react'

import { EmptyState } from '../EmptyState'

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="Nothing here" description="Add data to get started." />)

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('Add data to get started.')).toBeInTheDocument()
  })

  it('renders an accessible heading', () => {
    render(<EmptyState title="Nothing here" description="Add data to get started." />)

    const heading = screen.getByRole('heading', { name: 'Nothing here', level: 2 })
    expect(heading).toBeInTheDocument()
  })

  it('renders action CTA when action prop is provided', () => {
    render(
      <EmptyState
        title="No contacts yet"
        description="Create your first contact to build the customer source of truth."
        action={<a href="/contacts/new">Create contact</a>}
      />,
    )

    expect(screen.getByRole('link', { name: 'Create contact' })).toBeInTheDocument()
  })

  it('renders without action when action prop is omitted', () => {
    render(<EmptyState title="No data" description="There is nothing to show." />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders icon when icon prop is provided', () => {
    render(
      <EmptyState
        title="Empty"
        description="No items"
        icon={<span data-testid="test-icon">Icon</span>}
      />,
    )

    expect(screen.getByTestId('test-icon')).toBeInTheDocument()
  })

  it('does not render icon container when icon prop is omitted', () => {
    const { container } = render(<EmptyState title="Empty" description="No items" />)

    expect(container.querySelector('.rounded-full.bg-slate-100')).not.toBeInTheDocument()
  })
})
