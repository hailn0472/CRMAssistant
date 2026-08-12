// @ts-nocheck
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DealCollaboration } from '../DealCollaboration'

jest.mock('../DealTimeline', () => ({
  DealTimeline: () => <div data-testid="timeline-panel">Timeline panel</div>,
}))

jest.mock('../DealDocuments', () => ({
  DealDocuments: () => <div data-testid="documents-panel">Documents panel</div>,
}))

jest.mock('../DealComments', () => ({
  DealComments: () => <div data-testid="comments-panel">Comments panel</div>,
}))

jest.mock('@/services/deal-document.service', () => ({
  getDealDocuments: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/services/deal-comment.service', () => ({
  getDealComments: jest.fn().mockResolvedValue({ total: 2 }),
}))

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealCollaboration', () => {
  it('renders a tablist with Timeline, Documents and Comments triggers', () => {
    renderWithQuery(<DealCollaboration dealId="deal-1" />)

    const tablist = screen.getByRole('tablist', { name: 'Deal collaboration' })
    expect(tablist).toBeInTheDocument()

    const timelineTab = screen.getByRole('tab', { name: /Timeline/ })
    const documentsTab = screen.getByRole('tab', { name: /Documents/ })
    const commentsTab = screen.getByRole('tab', { name: /Comments/ })
    expect(timelineTab).toBeInTheDocument()
    expect(documentsTab).toBeInTheDocument()
    expect(commentsTab).toBeInTheDocument()
  })

  it('marks the active tab with aria-selected and links panels via aria-controls', () => {
    renderWithQuery(<DealCollaboration dealId="deal-1" />)

    const timelineTab = screen.getByRole('tab', { name: /Timeline/ })
    expect(timelineTab).toHaveAttribute('aria-selected', 'true')
    expect(timelineTab).toHaveAttribute('aria-controls', 'deal-collab-panel-timeline')
    expect(screen.getByRole('tab', { name: /Documents/ })).toHaveAttribute('aria-selected', 'false')

    // Only the active trigger is in the tab order.
    expect(timelineTab).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: /Documents/ })).toHaveAttribute('tabindex', '-1')

    const panel = screen.getByRole('tabpanel', { name: /Timeline/ })
    expect(panel).toHaveAttribute('aria-labelledby', 'deal-collab-tab-timeline')
  })

  it('shows the Timeline panel by default', () => {
    renderWithQuery(<DealCollaboration dealId="deal-1" />)
    expect(screen.getByTestId('timeline-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('documents-panel')).not.toBeInTheDocument()
  })

  it('switches to the Documents tab on click', () => {
    renderWithQuery(<DealCollaboration dealId="deal-1" />)

    fireEvent.click(screen.getByRole('tab', { name: /Documents/ }))

    expect(screen.getByTestId('documents-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('timeline-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Documents/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('moves focus with the Right arrow key and activates the next tab', () => {
    renderWithQuery(<DealCollaboration dealId="deal-1" />)

    const timelineTab = screen.getByRole('tab', { name: /Timeline/ })
    fireEvent.keyDown(timelineTab, { key: 'ArrowRight' })

    const documentsTab = screen.getByRole('tab', { name: /Documents/ })
    expect(documentsTab).toHaveFocus()
    expect(documentsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('documents-panel')).toBeInTheDocument()
  })

  it('wraps around with the Left arrow key', () => {
    renderWithQuery(<DealCollaboration dealId="deal-1" />)

    const timelineTab = screen.getByRole('tab', { name: /Timeline/ })
    fireEvent.keyDown(timelineTab, { key: 'ArrowLeft' })

    // With 4 tabs, ArrowLeft from first tab wraps to last (Notes)
    const notesTab = screen.getByRole('tab', { name: /Notes/ })
    expect(notesTab).toHaveFocus()
    expect(notesTab).toHaveAttribute('aria-selected', 'true')
  })

  it('ignores other keys in the tablist', () => {
    renderWithQuery(<DealCollaboration dealId="deal-1" />)

    fireEvent.keyDown(screen.getByRole('tab', { name: /Timeline/ }), { key: 'Home' })

    expect(screen.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true')
  })
})
