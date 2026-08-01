// @ts-nocheck
import { render, screen, fireEvent } from '@testing-library/react'

import { DealCollaboration } from '../DealCollaboration'

jest.mock('../DealDocuments', () => ({
  DealDocuments: () => <div data-testid="documents-panel">Documents panel</div>,
}))

jest.mock('../DealComments', () => ({
  DealComments: () => <div data-testid="comments-panel">Comments panel</div>,
}))

describe('DealCollaboration', () => {
  it('renders a tablist with Documents and Comments triggers', () => {
    render(<DealCollaboration dealId="deal-1" />)

    const tablist = screen.getByRole('tablist', { name: 'Deal collaboration' })
    expect(tablist).toBeInTheDocument()

    const documentsTab = screen.getByRole('tab', { name: 'Documents' })
    const commentsTab = screen.getByRole('tab', { name: 'Comments' })
    expect(documentsTab).toBeInTheDocument()
    expect(commentsTab).toBeInTheDocument()
  })

  it('marks the active tab with aria-selected and links panels via aria-controls', () => {
    render(<DealCollaboration dealId="deal-1" />)

    const documentsTab = screen.getByRole('tab', { name: 'Documents' })
    expect(documentsTab).toHaveAttribute('aria-selected', 'true')
    expect(documentsTab).toHaveAttribute('aria-controls', 'deal-collab-panel-documents')
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'false')

    // Only the active trigger is in the tab order.
    expect(documentsTab).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute('tabindex', '-1')

    const panel = screen.getByRole('tabpanel', { name: 'Documents' })
    expect(panel).toHaveAttribute('aria-labelledby', 'deal-collab-tab-documents')
  })

  it('shows the Documents panel by default', () => {
    render(<DealCollaboration dealId="deal-1" />)
    expect(screen.getByTestId('documents-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument()
  })

  it('switches to the Comments tab on click', () => {
    render(<DealCollaboration dealId="deal-1" />)

    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))

    expect(screen.getByTestId('comments-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('documents-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'false')
  })

  it('moves focus with the Right arrow key and activates the next tab', () => {
    render(<DealCollaboration dealId="deal-1" />)

    const documentsTab = screen.getByRole('tab', { name: 'Documents' })
    fireEvent.keyDown(documentsTab, { key: 'ArrowRight' })

    const commentsTab = screen.getByRole('tab', { name: 'Comments' })
    expect(commentsTab).toHaveFocus()
    expect(commentsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('comments-panel')).toBeInTheDocument()
  })

  it('wraps around with the Left arrow key', () => {
    render(<DealCollaboration dealId="deal-1" />)

    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))
    const commentsTab = screen.getByRole('tab', { name: 'Comments' })
    fireEvent.keyDown(commentsTab, { key: 'ArrowLeft' })

    const documentsTab = screen.getByRole('tab', { name: 'Documents' })
    expect(documentsTab).toHaveFocus()
    expect(documentsTab).toHaveAttribute('aria-selected', 'true')
  })

  it('ignores other keys in the tablist', () => {
    render(<DealCollaboration dealId="deal-1" />)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Documents' }), { key: 'Home' })

    expect(screen.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'true')
  })
})
