import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TagBadge } from '../TagBadge'

describe('TagBadge', () => {
  const tag = { id: 'tag-1', name: 'VIP', color: '#EF4444' }

  it('renders tag name', () => {
    render(<TagBadge tag={tag} />)
    expect(screen.getByText('VIP')).toBeInTheDocument()
  })

  it('renders remove button when onRemove is provided', () => {
    const onRemove = jest.fn()
    render(<TagBadge tag={tag} onRemove={onRemove} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls onRemove when remove button is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = jest.fn()
    render(<TagBadge tag={tag} onRemove={onRemove} />)

    await user.click(screen.getByRole('button'))
    expect(onRemove).toHaveBeenCalledWith(tag)
  })

  it('does not render remove button when onRemove is not provided', () => {
    render(<TagBadge tag={tag} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
