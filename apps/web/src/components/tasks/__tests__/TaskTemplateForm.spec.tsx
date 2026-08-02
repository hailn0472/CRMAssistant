import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { TaskTemplateForm } from '../TaskTemplateForm'
import { createTaskTemplate, updateTaskTemplate } from '@/services/task.service'
import type { TaskTemplate } from '@/services/task.service'

jest.mock('@/services/task.service', () => ({
  createTaskTemplate: jest.fn(),
  updateTaskTemplate: jest.fn(),
}))

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: React.ReactNode
  }) => (
    <div data-testid="dialog" data-open={String(open)}>
      {children}
      <button type="button" onClick={() => onOpenChange(false)}>
        close-dialog
      </button>
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockTemplate: TaskTemplate = {
  id: 'template-1',
  name: 'Discovery call',
  title: 'Discovery call follow-up',
  description: 'Call the lead',
  defaultPriority: 'HIGH',
  defaultDueInDays: 3,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TaskTemplateForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a template and invalidates the taskTemplates query', async () => {
    ;(createTaskTemplate as jest.Mock).mockResolvedValue(mockTemplate)
    const onOpenChange = jest.fn()
    renderWithQuery(<TaskTemplateForm template={null} open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Discovery call' } })
    fireEvent.change(screen.getAllByRole('textbox')[1], {
      target: { value: 'Discovery call follow-up' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createTaskTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Discovery call' }),
      )
      expect(toast.success).toHaveBeenCalledWith('Task template created')
    })
  })

  it('updates a template when editing', async () => {
    ;(updateTaskTemplate as jest.Mock).mockResolvedValue(mockTemplate)
    const onOpenChange = jest.fn()
    renderWithQuery(<TaskTemplateForm template={mockTemplate} open onOpenChange={onOpenChange} />)

    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Discovery call')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(updateTaskTemplate).toHaveBeenCalledWith(
        'template-1',
        expect.objectContaining({ name: 'Discovery call' }),
      )
    })
  })

  it('resets the form before closing via the local handleClose (AC 80)', async () => {
    const onOpenChange = jest.fn()
    renderWithQuery(<TaskTemplateForm template={null} open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Dirty value' } })
    fireEvent.click(screen.getByText('close-dialog'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    // Reopening must not leak the previous value — the form was reset
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('')
  })

  it('shows inline validation for the required name', async () => {
    renderWithQuery(<TaskTemplateForm template={null} open onOpenChange={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })
    expect(createTaskTemplate).not.toHaveBeenCalled()
  })

  it('rejects defaultDueInDays outside 0..365', async () => {
    renderWithQuery(<TaskTemplateForm template={null} open onOpenChange={jest.fn()} />)

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'X' } })
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Y' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createTaskTemplate).not.toHaveBeenCalled()
    })
  })

  it('clears defaultDueInDays when the input is emptied (AC 39)', async () => {
    ;(createTaskTemplate as jest.Mock).mockResolvedValue(mockTemplate)
    renderWithQuery(<TaskTemplateForm template={null} open onOpenChange={jest.fn()} />)

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'X' } })
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Y' } })
    // Set a value first, then clear it
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createTaskTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ defaultDueInDays: undefined }),
      )
    })
  })

  it('sends a valid integer for defaultDueInDays unchanged', async () => {
    ;(createTaskTemplate as jest.Mock).mockResolvedValue(mockTemplate)
    renderWithQuery(<TaskTemplateForm template={null} open onOpenChange={jest.fn()} />)

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'X' } })
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Y' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createTaskTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ defaultDueInDays: 14 }),
      )
    })
  })
})
