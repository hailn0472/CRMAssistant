import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TagFilterBar } from '../TagFilterBar'

describe('TagFilterBar', () => {
  const tags = [
    { id: 'tag-1', name: 'VIP', color: '#EF4444' },
    { id: 'tag-2', name: 'Hot Lead', color: '#F59E0B' },
  ]

  it('renders nothing when no tags selected', () => {
    const { container } = render(
      <TagFilterBar selectedTags={[]} onRemoveTag={jest.fn()} onClearAll={jest.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders selected tags', () => {
    render(<TagFilterBar selectedTags={tags} onRemoveTag={jest.fn()} onClearAll={jest.fn()} />)

    expect(screen.getByText('VIP')).toBeInTheDocument()
    expect(screen.getByText('Hot Lead')).toBeInTheDocument()
  })

  it('renders clear all button', () => {
    render(<TagFilterBar selectedTags={tags} onRemoveTag={jest.fn()} onClearAll={jest.fn()} />)

    expect(screen.getByText('Clear all')).toBeInTheDocument()
  })

  it('calls onClearAll when clear all is clicked', async () => {
    const user = userEvent.setup()
    const onClearAll = jest.fn()
    render(<TagFilterBar selectedTags={tags} onRemoveTag={jest.fn()} onClearAll={onClearAll} />)

    await user.click(screen.getByText('Clear all'))
    expect(onClearAll).toHaveBeenCalled()
  })
})
