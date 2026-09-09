import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'

import { NotesPanel } from '../NotesPanel'
import { createNote, deleteNote, getNotes, updateNote } from '@/services/note.service'
import type { Note } from '@/services/note.service'

const mockUsePermission = jest.fn()

jest.mock('@/hooks/usePermission', () => ({
  usePermission: (...args: unknown[]) => mockUsePermission(...args),
}))

jest.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: { user: { userId: string } }) => unknown) =>
    selector({ user: { userId: 'user-1' } }),
}))

jest.mock('@/services/note.service', () => ({
  getNotes: jest.fn(),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

const mockedGetNotes = getNotes as jest.MockedFunction<typeof getNotes>
const mockedCreateNote = createNote as jest.MockedFunction<typeof createNote>
const mockedUpdateNote = updateNote as jest.MockedFunction<typeof updateNote>
const mockedDeleteNote = deleteNote as jest.MockedFunction<typeof deleteNote>
const mockedToast = toast as jest.Mocked<typeof toast>

function makeNote(overrides: Partial<Note> = {}): Note {
  const createdAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  return {
    id: 'note-1',
    contactId: 'contact-1',
    userId: 'user-1',
    body: 'Follow up tomorrow',
    createdAt,
    updatedAt: createdAt,
    author: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
    ...overrides,
  }
}

function renderPanel(): { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <NotesPanel contactId="contact-1" />
    </QueryClientProvider>,
  )

  return { queryClient }
}

describe('NotesPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockReturnValue(true)
    mockedGetNotes.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    mockedCreateNote.mockImplementation(async ({ body }) => makeNote({ body }))
    mockedUpdateNote.mockImplementation(async (id, body) => makeNote({ id, body }))
    mockedDeleteNote.mockResolvedValue(true)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows loading, empty, and required-validation states', async () => {
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getByRole('status', { name: 'Loading content' })).toBeInTheDocument()
    expect(await screen.findByText('No notes yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save note' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Note is required')
    expect(mockUsePermission).toHaveBeenCalledWith('CONTACT', 'UPDATE')
  })

  it('renders the query error and retries the request', async () => {
    const user = userEvent.setup()
    mockedGetNotes.mockRejectedValueOnce(new Error('Notes are unavailable'))
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('Notes are unavailable')

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('No notes yet')).toBeInTheDocument()
    expect(mockedGetNotes).toHaveBeenCalledTimes(2)
  })

  it('shows permission-limited states without exposing author actions', async () => {
    mockUsePermission.mockReturnValue(false)
    mockedGetNotes.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
    const firstRender = renderPanel()

    expect(
      await screen.findByText('You do not have permission to view notes on this record.'),
    ).toBeInTheDocument()

    firstRender.queryClient.clear()
  })

  it('allows read-only users to view existing notes but not modify them', async () => {
    mockUsePermission.mockReturnValue(false)
    mockedGetNotes.mockResolvedValue({
      items: [makeNote()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderPanel()

    expect(await screen.findByText('Follow up tomorrow')).toBeInTheDocument()
    expect(
      screen.getByText('You do not have permission to add notes on this record.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit note by/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete note by/ })).not.toBeInTheDocument()
  })

  it('creates a note, reports success, and resets the composer', async () => {
    const user = userEvent.setup()
    renderPanel()

    const composer = await screen.findByRole('textbox', { name: 'Write a note' })
    await user.type(composer, 'Call the customer')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => {
      expect(mockedCreateNote).toHaveBeenCalledWith({
        contactId: 'contact-1',
        body: 'Call the customer',
      })
    })
    expect(mockedToast.success).toHaveBeenCalledWith('Note saved')
    expect(composer).toHaveValue('')
  })

  it('edits an authored note and closes the dialog after saving', async () => {
    const user = userEvent.setup()
    mockedGetNotes.mockResolvedValue({
      items: [makeNote()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Edit note by Ada Lovelace' }))
    const editBox = screen.getByRole('textbox', { name: 'Edit note' })
    expect(editBox).toHaveValue('Follow up tomorrow')

    await user.clear(editBox)
    await user.type(editBox, 'Updated follow-up')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockedUpdateNote).toHaveBeenCalledWith('note-1', 'Updated follow-up')
    })
    expect(mockedToast.success).toHaveBeenCalledWith('Note updated')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancels editing without calling the update service', async () => {
    const user = userEvent.setup()
    mockedGetNotes.mockResolvedValue({
      items: [makeNote()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Edit note by Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockedUpdateNote).not.toHaveBeenCalled()
  })

  it('deletes only after confirmation', async () => {
    const user = userEvent.setup()
    const confirmSpy = jest
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValue(true)
    mockedGetNotes.mockResolvedValue({
      items: [makeNote()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderPanel()

    const deleteButton = await screen.findByRole('button', {
      name: 'Delete note by Ada Lovelace',
    })
    await user.click(deleteButton)
    expect(mockedDeleteNote).not.toHaveBeenCalled()

    await user.click(deleteButton)
    await waitFor(() => expect(mockedDeleteNote).toHaveBeenCalledWith('note-1'))
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(mockedToast.success).toHaveBeenCalledWith('Note deleted')
  })

  it('renders edited state and all relative-time ranges', async () => {
    const now = Date.now()
    const notes = [
      makeNote({
        id: 'future',
        body: 'Future',
        createdAt: new Date(now + 86_400_000).toISOString(),
      }),
      makeNote({ id: 'now', body: 'Now', createdAt: new Date(now).toISOString() }),
      makeNote({
        id: 'minutes',
        body: 'Minutes',
        createdAt: new Date(now - 30 * 60_000).toISOString(),
      }),
      makeNote({
        id: 'hours',
        body: 'Hours',
        createdAt: new Date(now - 2 * 3_600_000).toISOString(),
      }),
      makeNote({
        id: 'days',
        body: 'Days',
        createdAt: new Date(now - 2 * 86_400_000).toISOString(),
      }),
      makeNote({
        id: 'old',
        body: 'Old',
        createdAt: new Date(now - 8 * 86_400_000).toISOString(),
        updatedAt: new Date(now - 7 * 86_400_000).toISOString(),
      }),
    ]
    mockedGetNotes.mockResolvedValue({ items: notes, total: notes.length, page: 1, pageSize: 20 })
    renderPanel()

    expect(await screen.findByText('just now')).toBeInTheDocument()
    expect(screen.getByText('30m ago')).toBeInTheDocument()
    expect(screen.getByText('2h ago')).toBeInTheDocument()
    expect(screen.getByText('2d ago')).toBeInTheDocument()
    expect(screen.getAllByText('(edited)').length).toBeGreaterThan(0)
  })
})
