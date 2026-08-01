// @ts-nocheck
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { MentionInput } from '../MentionInput'
import { getDealMentionCandidates } from '@/services/deal-comment.service'

jest.mock('@/services/deal-comment.service', () => ({
  getDealMentionCandidates: jest.fn(),
}))

const candidates = [
  { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', avatar: null },
  {
    id: 'user-2',
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.com',
    avatar: null,
  },
]

// Stateful harness — the component is controlled, so the parent must re-render
// with the new value for the insertion math to see the full draft.
function Harness({ dealId }: { dealId: string }): React.JSX.Element {
  const [value, setValue] = useState('')
  return <MentionInput dealId={dealId} value={value} onChange={setValue} />
}

function renderInput() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness dealId="deal-1" />
    </QueryClientProvider>,
  )
}

function typeAt(textarea: HTMLTextAreaElement, value: string, caret: number): void {
  fireEvent.change(textarea, { target: { value, selectionStart: caret } })
}

describe('MentionInput', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getDealMentionCandidates.mockResolvedValue(candidates)
  })

  it('renders a labelled textarea', () => {
    renderInput()
    expect(screen.getByLabelText('Comment')).toBeInTheDocument()
  })

  it('opens the picker when @ is typed and fetches candidates', async () => {
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, 'Hi @', 4)

    await waitFor(() => {
      expect(getDealMentionCandidates).toHaveBeenCalledWith('deal-1', undefined)
    })
    const listbox = await screen.findByRole('listbox', { name: 'Mention someone' })
    expect(listbox).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('filters candidates as the query after @ grows', async () => {
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, '@Gra', 4)

    await waitFor(() => {
      expect(getDealMentionCandidates).toHaveBeenCalledWith('deal-1', 'Gra')
    })
  })

  it('closes the picker when a space ends the mention attempt', async () => {
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, '@Gra', 4)
    await screen.findByRole('listbox')

    typeAt(textarea, '@Gra ', 5)

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })

  it('moves the highlight with Up and Down arrows', async () => {
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, '@', 1)
    await screen.findAllByRole('option')

    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    expect(textarea).toHaveAttribute('aria-activedescendant', 'mention-option-user-2')

    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(textarea).toHaveAttribute('aria-activedescendant', 'mention-option-user-1')
  })

  it('inserts the highlighted mention token at the caret on Enter', async () => {
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, 'cc @Gra', 7)
    await screen.findAllByRole('option')

    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('cc @[Grace Hopper](user-2) ')
    })
  })

  it('inserts the first candidate on Tab', async () => {
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, '@', 1)
    await screen.findAllByRole('option')

    fireEvent.keyDown(textarea, { key: 'Tab' })

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('@[Ada Lovelace](user-1) ')
    })
  })

  it('closes the picker on Escape and leaves the draft intact', async () => {
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, '@Gra', 4)
    await screen.findByRole('listbox')

    fireEvent.keyDown(textarea, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
    // The draft is untouched — no token inserted, no text changed.
    expect((textarea as HTMLTextAreaElement).value).toBe('@Gra')
  })

  it('selects a candidate by clicking it', async () => {
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, '@Gra', 4)
    const options = await screen.findAllByRole('option')

    fireEvent.mouseDown(options[1])

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('@[Grace Hopper](user-2) ')
    })
  })

  it('shows a no-matches row when the query matches nobody', async () => {
    getDealMentionCandidates.mockResolvedValue([])
    renderInput()
    const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement

    typeAt(textarea, '@zzz', 4)

    await waitFor(() => {
      expect(screen.getByText('No matching people')).toBeInTheDocument()
    })
  })
})
