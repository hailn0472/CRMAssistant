import { render, screen, fireEvent } from '@testing-library/react'
import { NoteComposer } from '../NoteComposer'

describe('NoteComposer', () => {
  const mockOnSubmit = jest.fn()

  beforeEach(() => {
    mockOnSubmit.mockClear()
  })

  it('renders textarea and save button', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    expect(screen.getByPlaceholderText(/Add a note/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('disables save button when empty', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).toBeDisabled()
  })

  it('enables save button when text is entered', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'Test note content' } })

    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).not.toBeDisabled()
  })

  it('shows character counter', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    expect(screen.getByText('0/1000')).toBeInTheDocument()
  })

  it('updates character counter as user types', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'Hello' } })

    expect(screen.getByText('5/1000')).toBeInTheDocument()
  })

  it('shows warning color when near limit (>= 900 chars)', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'A'.repeat(900) } })

    const counter = screen.getByText('900/1000')
    expect(counter.className).toContain('amber')
  })

  it('shows error color when over limit (> 1000 chars)', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'A'.repeat(1001) } })

    const counter = screen.getByText('1001/1000')
    expect(counter.className).toContain('red')
  })

  it('disables save button when over limit', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'A'.repeat(1001) } })

    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).toBeDisabled()
  })

  it('calls onSubmit and clears text on form submit', () => {
    mockOnSubmit.mockResolvedValue(undefined)
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'Test note' } })

    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

    expect(mockOnSubmit).toHaveBeenCalledWith('Test note')
  })

  it('shows "Saving..." when isSubmitting is true', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} isSubmitting={true} />)
    expect(screen.getByText('Saving...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  it('disables textarea when isSubmitting', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} isSubmitting={true} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    expect(textarea).toBeDisabled()
  })

  it('submits via Ctrl+Enter', () => {
    mockOnSubmit.mockResolvedValue(undefined)
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'Ctrl+Enter note' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(mockOnSubmit).toHaveBeenCalledWith('Ctrl+Enter note')
  })

  it('submits via Meta+Enter (Cmd+Enter)', () => {
    mockOnSubmit.mockResolvedValue(undefined)
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'Meta+Enter note' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    expect(mockOnSubmit).toHaveBeenCalledWith('Meta+Enter note')
  })

  it('does not submit via Enter alone (without Ctrl/Meta)', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'Plain enter' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('does not submit when empty via Ctrl+Enter', () => {
    render(<NoteComposer onSubmit={mockOnSubmit} />)
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(mockOnSubmit).not.toHaveBeenCalled()
  })
})
