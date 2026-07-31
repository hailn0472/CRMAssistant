import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { WinLossDialog, WIN_LOSS_REASONS } from '../WinLossDialog'
import { getCompetitors, recordWinLoss } from '@/services/competitor.service'

jest.mock('@/services/competitor.service', () => ({
  getCompetitors: jest.fn(),
  recordWinLoss: jest.fn(),
}))

const mockCompetitors = {
  items: [
    {
      id: 'c1',
      name: 'Acme Corp',
      website: null,
      strengths: null,
      weaknesses: null,
      isActive: true,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof WinLossDialog>> = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <WinLossDialog
        dealId="deal-1"
        stageId="stage-won"
        stageName="Closed Won"
        isWon
        isLost={false}
        open
        onOpenChange={jest.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  )
}

describe('WinLossDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders all six reasons with human labels (AC #28)', () => {
    renderDialog()

    const select = screen.getByLabelText('Reason')
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual(
      expect.arrayContaining([
        'Select a reason...',
        'Price',
        'Features',
        'Timing',
        'Competitor',
        'Budget',
        'Other',
      ]),
    )
    expect(WIN_LOSS_REASONS).toHaveLength(6)
  })

  it('shows the competitor picker when reason is COMPETITOR (AC #28)', async () => {
    ;(getCompetitors as jest.Mock).mockResolvedValue(mockCompetitors)
    renderDialog()

    const select = screen.getByLabelText('Reason')
    fireEvent.change(select, { target: { value: 'COMPETITOR' } })

    const search = screen.getByPlaceholderText('Search competitors...')
    fireEvent.change(search, { target: { value: 'acme' } })
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
  })

  it('shows a required note textarea when reason is OTHER (AC #28)', async () => {
    renderDialog()

    const select = screen.getByLabelText('Reason')
    fireEvent.change(select, { target: { value: 'OTHER' } })

    const textarea = screen.getByLabelText('Note')
    expect(textarea).toBeInTheDocument()

    // Submitting without a note surfaces the inline error
    fireEvent.click(screen.getByText('Mark as Closed Won'))
    expect(await screen.findByText('Note is required when reason is Other')).toBeInTheDocument()
    expect(recordWinLoss).not.toHaveBeenCalled()
  })

  it('validates competitorId when reason is COMPETITOR (AC #28)', async () => {
    renderDialog()

    const select = screen.getByLabelText('Reason')
    fireEvent.change(select, { target: { value: 'COMPETITOR' } })

    fireEvent.click(screen.getByText('Mark as Closed Won'))
    expect(
      await screen.findByText('Competitor is required when reason is Competitor'),
    ).toBeInTheDocument()
    expect(recordWinLoss).not.toHaveBeenCalled()
  })

  it('calls recordWinLoss with the stage, reason and note on confirm (AC #28)', async () => {
    ;(recordWinLoss as jest.Mock).mockResolvedValue({ id: 'deal-1' })
    renderDialog()

    const select = screen.getByLabelText('Reason')
    fireEvent.change(select, { target: { value: 'BUDGET' } })
    fireEvent.click(screen.getByText('Mark as Closed Won'))

    await waitFor(() => {
      expect(recordWinLoss).toHaveBeenCalledWith({
        dealId: 'deal-1',
        stageId: 'stage-won',
        reason: 'BUDGET',
        competitorId: null,
        note: null,
      })
    })
  })

  it('uses the concrete verb for lost stages (AC #28)', () => {
    renderDialog({ isWon: false, isLost: true, stageName: 'Closed Lost', stageId: 'stage-lost' })

    expect(screen.getByText('Mark as Closed Lost')).toBeInTheDocument()
    expect(screen.queryByText('Mark as Closed Won')).not.toBeInTheDocument()
  })

  it('renders server errors in a role="alert" panel (AC #28)', async () => {
    ;(recordWinLoss as jest.Mock).mockRejectedValue(
      new Error('stageId must reference a closed stage'),
    )
    renderDialog()

    const select = screen.getByLabelText('Reason')
    fireEvent.change(select, { target: { value: 'PRICE' } })
    fireEvent.click(screen.getByText('Mark as Closed Won'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'stageId must reference a closed stage',
    )
  })
})
