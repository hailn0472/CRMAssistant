import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetFrame } from '../WidgetFrame'

describe('WidgetFrame', () => {
  const baseWidget: Parameters<typeof WidgetFrame>[0]['widget'] = {
    id: 'w-1',
    type: 'METRIC_CARD',
    title: 'Pipeline Value',
    config: { source: 'PIPELINE_VALUE', dateRangeDays: 30, stageId: null, ownerId: null, limit: 5 },
    position: 0,
    size: '1x1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }

  function renderEditing(
    props: Partial<Parameters<typeof WidgetFrame>[0]> = {},
  ): ReturnType<typeof render> {
    return render(
      <WidgetFrame widget={baseWidget} isEditing {...props}>
        <p>Content</p>
      </WidgetFrame>,
    )
  }

  it('renders loading skeleton when isLoading', () => {
    const { container } = render(<WidgetFrame widget={baseWidget} isLoading />)
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders error state when isError', () => {
    const { container } = render(
      <WidgetFrame widget={baseWidget} isError errorMessage="Failed to load widget data" />,
    )
    // ErrorState renders some content (with retry option)
    expect(container.textContent).toContain('Could not load')
  })

  it('renders permission limited state', () => {
    render(<WidgetFrame widget={baseWidget} isPermissionLimited />)
    expect(screen.getByText('Pipeline Value unavailable')).toBeDefined()
  })

  it('renders widget with title and content', () => {
    render(
      <WidgetFrame widget={baseWidget}>
        <p>Widget content</p>
      </WidgetFrame>,
    )
    expect(screen.getByText('Pipeline Value')).toBeDefined()
    expect(screen.getByText('Widget content')).toBeDefined()
  })

  it('shows edit menu trigger when isEditing', () => {
    renderEditing()
    expect(screen.getByLabelText('Widget actions for Pipeline Value')).toBeDefined()
  })

  it('renders a drag handle when dragHandleProps is provided (AC 67)', () => {
    const dragHandleProps: NonNullable<Parameters<typeof WidgetFrame>[0]['dragHandleProps']> = {
      attributes: {
        role: 'button',
        tabIndex: 0,
        'aria-disabled': false,
        'aria-pressed': false,
        'aria-roledescription': 'draggable',
        'aria-describedby': 'dnd-desc',
      },
      listeners: undefined,
    }
    render(
      <WidgetFrame widget={baseWidget} isEditing dragHandleProps={dragHandleProps}>
        <p>Content</p>
      </WidgetFrame>,
    )
    expect(screen.getByLabelText('Drag Pipeline Value')).toBeDefined()
  })

  it('does not render a drag handle when not editing', () => {
    render(
      <WidgetFrame widget={baseWidget}>
        <p>Content</p>
      </WidgetFrame>,
    )
    expect(screen.queryByLabelText('Drag Pipeline Value')).toBeNull()
  })

  it('hides edit menu trigger when not editing', () => {
    render(
      <WidgetFrame widget={baseWidget}>
        <p>Content</p>
      </WidgetFrame>,
    )
    expect(screen.queryByLabelText('Widget actions for Pipeline Value')).toBeNull()
  })

  it('opens menu on trigger click', async () => {
    const user = userEvent.setup()
    renderEditing()
    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    expect(screen.getByText('Move up')).toBeDefined()
    expect(screen.getByText('Remove widget')).toBeDefined()
  })

  it('invokes onMoveUp and closes menu when Move up clicked', async () => {
    const onMoveUp = jest.fn()
    const user = userEvent.setup()
    renderEditing({ onMoveUp })
    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    await user.click(screen.getByText('Move up'))
    expect(onMoveUp).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Remove widget')).toBeNull()
  })

  it('invokes onMoveDown when Move down clicked', async () => {
    const onMoveDown = jest.fn()
    const user = userEvent.setup()
    renderEditing({ onMoveDown })
    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    await user.click(screen.getByText('Move down'))
    expect(onMoveDown).toHaveBeenCalledTimes(1)
  })

  it('invokes onResize with the correct size for each option', async () => {
    const onResize = jest.fn()
    const user = userEvent.setup()
    renderEditing({ onResize })
    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))

    await user.click(screen.getByText(/Resize to Small/))
    expect(onResize).toHaveBeenLastCalledWith('1x1')

    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    await user.click(screen.getByText(/Resize to Wide/))
    expect(onResize).toHaveBeenLastCalledWith('2x1')

    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    await user.click(screen.getByText(/Resize to Medium/))
    expect(onResize).toHaveBeenLastCalledWith('2x2')

    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    await user.click(screen.getByText(/Resize to Large/))
    expect(onResize).toHaveBeenLastCalledWith('3x2')
  })

  it('confirms before removing and invokes onRemove', async () => {
    const onRemove = jest.fn()
    const user = userEvent.setup()
    renderEditing({ onRemove })
    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    await user.click(screen.getByText('Remove widget'))
    // Confirm step — onRemove is not called yet
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('Remove this widget?')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('cancels the remove confirmation', async () => {
    const onRemove = jest.fn()
    const user = userEvent.setup()
    renderEditing({ onRemove })
    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    await user.click(screen.getByText('Remove widget'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('Remove widget')).toBeDefined()
  })

  it('marks Move/Resize menu items as mobile-hidden (Remove stays visible)', async () => {
    const user = userEvent.setup()
    renderEditing()
    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    // Move up is present but hidden below sm (AC 84)
    const moveUp = screen.getByText('Move up')
    expect(moveUp.className).toContain('hidden')
    expect(moveUp.className).toContain('sm:flex')
    // Remove widget is always visible (no `hidden sm:` classes)
    const remove = screen.getByText('Remove widget')
    expect(remove.className).not.toContain('hidden')
  })

  it('closes menu when clicking outside', async () => {
    const user = userEvent.setup()
    renderEditing()
    await user.click(screen.getByLabelText('Widget actions for Pipeline Value'))
    expect(screen.getByText('Move up')).toBeDefined()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByText('Move up')).toBeNull()
  })
})
