// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { CompetitorForm } from '../CompetitorForm'
import { createCompetitor, updateCompetitor } from '@/services/competitor.service'

jest.mock('@/services/competitor.service', () => ({
  createCompetitor: jest.fn(),
  updateCompetitor: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

function renderWithQuery(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CompetitorForm', () => {
  const onOpenChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('validates the required name field (AC #29)', async () => {
    renderWithQuery(<CompetitorForm open onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByText('Create'))

    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(createCompetitor).not.toHaveBeenCalled()
  })

  it('creates a competitor via the service (AC #29)', async () => {
    createCompetitor.mockResolvedValue({
      id: 'c1',
      name: 'Acme Corp',
      website: null,
      strengths: null,
      weaknesses: null,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    })
    renderWithQuery(<CompetitorForm open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByText('Create'))

    await waitFor(() => {
      expect(createCompetitor).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme Corp' }))
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledWith('Competitor created')
  })

  it('updates an existing competitor pre-filled with its data (AC #29)', async () => {
    const existing = {
      id: 'c1',
      name: 'Acme Corp',
      website: 'https://acme.test',
      strengths: 'Brand',
      weaknesses: null,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    }
    updateCompetitor.mockResolvedValue(existing)
    renderWithQuery(<CompetitorForm competitor={existing} open onOpenChange={onOpenChange} />)

    expect(screen.getByLabelText('Name')).toHaveValue('Acme Corp')
    expect(screen.getByLabelText('Website')).toHaveValue('https://acme.test')

    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://new.test' } })
    fireEvent.click(screen.getByText('Update'))

    await waitFor(() => {
      expect(updateCompetitor).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ website: 'https://new.test' }),
      )
    })
    expect(toast.success).toHaveBeenCalledWith('Competitor updated')
  })

  it('renders a duplicate-name server error inline (AC #29)', async () => {
    createCompetitor.mockRejectedValue(new Error('Competitor name already exists'))
    renderWithQuery(<CompetitorForm open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByText('Create'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Competitor name already exists')
  })
})
