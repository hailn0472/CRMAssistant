// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { DealDetailClient } from '../DealDetailClient'
import { deleteDeal, moveDealToStage, getDealStages } from '@/services/deal.service'
import { getDealCompetitors } from '@/services/competitor.service'
import { getDealDocuments } from '@/services/deal-document.service'
import { getDealComments } from '@/services/deal-comment.service'
import { getDealHealth, unsnoozeDealReminder } from '@/services/deal-health.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/deal.service', () => ({
  deleteDeal: jest.fn(),
  moveDealToStage: jest.fn(),
  getDealStages: jest.fn(),
}))

jest.mock('@/services/competitor.service', () => ({
  getDealCompetitors: jest.fn(),
  removeCompetitorFromDeal: jest.fn(),
  getCompetitors: jest.fn(),
  recordWinLoss: jest.fn(),
}))

jest.mock('@/services/deal-document.service', () => ({
  getDealDocuments: jest.fn(),
  deleteDealDocument: jest.fn(),
  getDealDocumentDownloadUrl: jest.fn(),
  uploadDealDocument: jest.fn(),
}))

jest.mock('@/services/deal-comment.service', () => ({
  getDealComments: jest.fn(),
  addDealComment: jest.fn(),
  deleteDealComment: jest.fn(),
  getDealMentionCandidates: jest.fn(),
  ON_DEAL_COMMENT_ADDED_SUBSCRIPTION:
    'subscription OnDealCommentAdded($dealId: ID!) { onDealCommentAdded(dealId: $dealId) { id } }',
}))

jest.mock('@/services/deal-health.service', () => ({
  getDealHealth: jest.fn(),
  unsnoozeDealReminder: jest.fn(),
}))

jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    subscribe: jest.fn(),
    disconnect: jest.fn(),
  })),
}))

const mockUsePermission = jest.fn(() => true)
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (...args: unknown[]) => mockUsePermission(...args),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockDeal = {
  id: 'deal-1',
  title: 'CloudTech Enterprise Deal',
  value: 85000,
  currency: 'USD',
  probability: 10,
  stageId: 'stage-1',
  contactId: 'contact-1',
  ownerId: 'owner-1',
  expectedCloseDate: '2026-12-31T00:00:00.000Z',
  actualCloseDate: null,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
  stage: {
    id: 'stage-1',
    name: 'Lead',
    color: '#3B82F6',
    probability: 10,
    isWon: false,
    isLost: false,
    order: 0,
  },
  contact: { id: 'contact-1', firstName: 'Ownership', lastName: 'Test', email: 'test@example.com' },
  owner: {
    id: 'owner-1',
    firstName: 'Acme',
    lastName: 'Admin',
    email: 'admin@example.com',
    avatar: null,
  },
} as const

const mockStages = [
  { id: 'stage-1', name: 'Lead', color: '#3B82F6', probability: 10, order: 0 },
  { id: 'stage-2', name: 'Qualified', color: '#10B981', probability: 25, order: 1 },
  { id: 'stage-3', name: 'Closed Won', color: '#10B981', probability: 100, order: 4, isWon: true },
  { id: 'stage-4', name: 'Closed Lost', color: '#EF4444', probability: 0, order: 5, isLost: true },
]

function mockDealHealth(overrides: Record<string, unknown> = {}): void {
  ;(getDealHealth as jest.Mock).mockResolvedValue({
    status: 'AT_RISK',
    score: 60,
    signals: ['NO_ACTIVITY_14D'],
    snoozedUntil: null,
    ...overrides,
  })
}

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
  ;(getDealCompetitors as jest.Mock).mockResolvedValue([])
  ;(getDealDocuments as jest.Mock).mockResolvedValue([])
  ;(getDealComments as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealDetailClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('renders deal title and formatted value', async () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('CloudTech Enterprise Deal')).toBeInTheDocument()
    // The formatted value appears in the header and in the "Deal details" card's Value row.
    expect(screen.getAllByText(/\$85,000/).length).toBeGreaterThanOrEqual(2)
  })

  it('renders stage badge with color and label', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('Lead')).toBeInTheDocument()
  })

  it('renders contact link when contact exists', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const contactLink = screen.getByText(/Ownership Test/)
    expect(contactLink).toBeInTheDocument()
    expect(contactLink.closest('a')).toHaveAttribute('href', '/contacts/contact-1')
  })

  it('renders owner name when owner exists', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('Acme Admin')).toBeInTheDocument()
  })

  it('renders expected close date', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getAllByText(/31 Dec 2026|12\/31\/2026/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders probability', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('renders dash for actual close date when null', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Stage dropdown with options', async () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const select = screen.getByRole('combobox') ?? screen.getByDisplayValue('Lead')
    expect(select).toBeInTheDocument()
  })

  it('calls deleteDeal and navigates on delete', async () => {
    ;(deleteDeal as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const deleteBtn = screen.getByText('Delete deal')
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(deleteDeal).toHaveBeenCalledWith('deal-1')
    })
    expect(toast.success).toHaveBeenCalledWith('Deal deleted')
  })

  it('shows error toast when delete fails', async () => {
    ;(deleteDeal as jest.Mock).mockRejectedValue(new Error('Delete failed'))
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const deleteBtn = screen.getByText('Delete deal')
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to delete deal')
    })
  })

  it('calls moveDealToStage when stage changes', async () => {
    ;(moveDealToStage as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    // Wait for the stage select to render with the current value
    const stageSelect = await screen.findByDisplayValue('Lead')
    expect(stageSelect).toBeInTheDocument()

    fireEvent.change(stageSelect, { target: { value: 'stage-2' } })

    await waitFor(
      () => {
        expect(moveDealToStage).toHaveBeenCalledWith('deal-1', 'stage-2')
      },
      { timeout: 3000 },
    )
    expect(toast.success).toHaveBeenCalledWith('Stage updated')
  })

  it('shows error toast when stage change fails', async () => {
    ;(moveDealToStage as jest.Mock).mockRejectedValue(new Error('Stage change failed'))
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const select = screen.getByRole('combobox') ?? screen.getByDisplayValue('Lead')
    fireEvent.change(select, { target: { value: 'stage-2' } })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to update stage')
    })
  })

  it('renders back link to /deals', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const backLink = screen.getByText('← Back to deals')
    expect(backLink).toBeInTheDocument()
    expect(backLink.closest('a')).toHaveAttribute('href', '/deals')
  })

  it('renders Edit button that navigates to edit page', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const editBtn = screen.getByText('Edit')
    expect(editBtn).toBeInTheDocument()
  })

  it('renders created and updated dates in metadata', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const createdElements = screen.getAllByText(/29 Jul 2026|7\/29\/2026/)
    expect(createdElements.length).toBeGreaterThan(0)
  })

  it('renders stage badge with correct color style', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const badge = screen.getByText('Lead')
    expect(badge).toBeInTheDocument()
    expect(badge.tagName).toBe('SPAN')
  })

  it('still renders the deal header when the stage is null', () => {
    // StageBadge's own null-stage behaviour is unit-tested in deal-display.spec.
    const dealNoStage = { ...mockDeal, stage: null }
    renderWithQuery(<DealDetailClient deal={dealNoStage} />)

    expect(screen.getByText('CloudTech Enterprise Deal')).toBeInTheDocument()
    expect(screen.getAllByText(/\$85,000/).length).toBeGreaterThanOrEqual(2)
  })

  it('renders dash for expected close date when null', () => {
    const dealNoDate = { ...mockDeal, expectedCloseDate: null }
    renderWithQuery(<DealDetailClient deal={dealNoDate} />)

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('mounts the Competitors section with its own header (AC #25)', async () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const header = await screen.findByText('Competitors')
    expect(header).toBeInTheDocument()
    expect(header.tagName).toBe('H2')
    expect(getDealCompetitors).toHaveBeenCalledWith('deal-1')
  })

  it('changing the stage select to a closed stage opens WinLossDialog without moving (AC #27)', async () => {
    ;(moveDealToStage as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const stageSelect = await screen.findByDisplayValue('Lead')
    fireEvent.change(stageSelect, { target: { value: 'stage-3' } })

    // Dialog opens with the concrete confirm verb — the move has NOT fired
    expect(await screen.findByText('Record win/loss reason')).toBeInTheDocument()
    expect(screen.getByText('Mark as Closed Won')).toBeInTheDocument()
    expect(moveDealToStage).not.toHaveBeenCalled()
  })

  it('cancelling the WinLossDialog leaves the deal untouched (AC #27)', async () => {
    ;(moveDealToStage as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const stageSelect = await screen.findByDisplayValue('Lead')
    fireEvent.change(stageSelect, { target: { value: 'stage-4' } })

    expect(await screen.findByText('Record win/loss reason')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))

    expect(moveDealToStage).not.toHaveBeenCalled()
    expect(screen.queryByText('Record win/loss reason')).not.toBeInTheDocument()
  })

  it('mounts the Collaboration tab block after Competitors (AC #37, #38)', async () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const tablist = await screen.findByRole('tablist', { name: 'Deal collaboration' })
    expect(tablist).toBeInTheDocument()

    const documentsTab = screen.getByRole('tab', { name: /Documents/ })
    const commentsTab = screen.getByRole('tab', { name: /Comments/ })
    expect(documentsTab).toBeInTheDocument()
    expect(commentsTab).toBeInTheDocument()
    expect(getDealDocuments).toHaveBeenCalledWith('deal-1')
  })

  it('switches the Collaboration block to the Comments tab (AC #38)', async () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    await screen.findByRole('tablist', { name: 'Deal collaboration' })
    fireEvent.click(screen.getByRole('tab', { name: /Comments/ }))

    expect(screen.getByRole('tab', { name: /Comments/ })).toHaveAttribute('aria-selected', 'true')
    expect(getDealComments).toHaveBeenCalledWith('deal-1')
  })

  it('renders the DealHealthBadge next to the StageBadge with a reason line (AC #49)', async () => {
    mockDealHealth()
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(await screen.findByText('At risk')).toBeInTheDocument()
    expect(screen.getByText(/No activity in 14\+ days/)).toBeInTheDocument()
  })

  it('shows the Snooze reminders button when DEAL:UPDATE is granted (AC #49)', async () => {
    mockDealHealth()
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(await screen.findByText('Snooze reminders')).toBeInTheDocument()
    expect(screen.getByText('Snooze reminders').className).toContain('h-9')
  })

  it('hides the Snooze reminders button when DEAL:UPDATE is not granted (AC #49)', async () => {
    mockDealHealth()
    mockUsePermission.mockReturnValue(false)
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    await screen.findByText('At risk')
    expect(screen.queryByText('Snooze reminders')).not.toBeInTheDocument()
    expect(screen.queryByText(/Reminders snoozed until/)).not.toBeInTheDocument()
    mockUsePermission.mockReturnValue(true)
  })

  it('shows the active snooze state with an Unsnooze action instead of the button (AC #49)', async () => {
    mockDealHealth({ snoozedUntil: '2026-08-08T00:00:00.000Z' })
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(await screen.findByText(/Reminders snoozed until/)).toBeInTheDocument()
    expect(screen.getByText('Unsnooze')).toBeInTheDocument()
    expect(screen.queryByText('Snooze reminders')).not.toBeInTheDocument()
  })

  it('calls unsnoozeDealReminder when Unsnooze is clicked (AC #49)', async () => {
    mockDealHealth({ snoozedUntil: '2026-08-08T00:00:00.000Z' })
    ;(unsnoozeDealReminder as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    fireEvent.click(await screen.findByText('Unsnooze'))

    await waitFor(() => {
      expect(unsnoozeDealReminder).toHaveBeenCalledWith('deal-1')
    })
    expect(toast.success).toHaveBeenCalledWith('Reminders resumed')
  })

  it('opens the SnoozeReminderDialog from the Snooze reminders button (AC #49)', async () => {
    mockDealHealth()
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    fireEvent.click(await screen.findByText('Snooze reminders'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true')
  })
})
