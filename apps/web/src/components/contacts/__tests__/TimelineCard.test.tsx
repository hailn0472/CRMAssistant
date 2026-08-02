import { render, screen, fireEvent } from '@testing-library/react'
import { TimelineCard } from '../TimelineCard'

describe('TimelineCard', () => {
  const defaultProps = {
    type: 'NOTE_ADDED' as const,
    title: 'Test activity',
    description: 'This is a test activity description',
    createdAt: new Date().toISOString(),
    createdBy: 'user-1',
  }

  it('renders title and description', () => {
    render(<TimelineCard {...defaultProps} />)
    expect(screen.getByText('Test activity')).toBeInTheDocument()
    expect(screen.getByText('This is a test activity description')).toBeInTheDocument()
  })

  it('renders the creator name', () => {
    render(<TimelineCard {...defaultProps} />)
    expect(screen.getByText(/by user-1/)).toBeInTheDocument()
  })

  it('renders a relative timestamp', () => {
    render(<TimelineCard {...defaultProps} />)
    // Should display "just now" since createdAt is very recent
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('renders a relative timestamp for past dates', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(<TimelineCard {...defaultProps} createdAt={oneHourAgo} />)
    expect(screen.getByText(/1 hour ago/)).toBeInTheDocument()
  })

  it('renders a relative timestamp for past days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    render(<TimelineCard {...defaultProps} createdAt={threeDaysAgo} />)
    expect(screen.getByText(/3 days ago/)).toBeInTheDocument()
  })

  it('truncates long descriptions and shows "Show more" button', () => {
    const longDescription = 'A'.repeat(250)
    render(<TimelineCard {...defaultProps} description={longDescription} />)

    // Should be truncated to 200 chars + '...'
    expect(screen.getByText(/\.\.\.$/)).toBeInTheDocument()
    expect(screen.getByText('Show more')).toBeInTheDocument()
    expect(screen.queryByText(longDescription)).not.toBeInTheDocument()
  })

  it('expands truncated description when "Show more" is clicked', () => {
    const longDescription = 'A'.repeat(250)
    render(<TimelineCard {...defaultProps} description={longDescription} />)

    fireEvent.click(screen.getByText('Show more'))
    expect(screen.getByText(longDescription)).toBeInTheDocument()
  })

  it('renders without description', () => {
    render(<TimelineCard {...defaultProps} description={null} />)
    expect(screen.getByText('Test activity')).toBeInTheDocument()
    expect(screen.queryByText(/by user-1/)).toBeInTheDocument()
  })

  it('does not show timeline line for last item', () => {
    const { container } = render(<TimelineCard {...defaultProps} isLast={true} />)
    // The timeline line is an aria-hidden div — should not exist when isLast is true
    const timelineLines = container.querySelectorAll('[aria-hidden="true"]')
    expect(timelineLines.length).toBe(0)
  })

  it('shows timeline line when not last item', () => {
    const { container } = render(<TimelineCard {...defaultProps} isLast={false} />)
    const timelineLines = container.querySelectorAll('[aria-hidden="true"]')
    expect(timelineLines.length).toBe(1)
  })

  // Story 4.2 — Auto badge (AC 48)
  it('renders the Auto badge with a text label when source is set (AC 48 / W7, W8)', () => {
    render(<TimelineCard {...defaultProps} source="TASK" />)

    const badge = screen.getByText('Auto')
    expect(badge).toBeInTheDocument()
    // Not purely colour-based: the badge has a readable text label.
    expect(badge.textContent).toBe('Auto')
    expect(badge.getAttribute('aria-label')).toBe('Automatically logged from TASK')
    expect(badge.getAttribute('title')).toBe('Automatically logged from TASK')
  })

  it('does not render the Auto badge when source is null (W9)', () => {
    render(<TimelineCard {...defaultProps} source={null} />)

    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
  })

  it('does not render the Auto badge when source is absent (W10)', () => {
    render(<TimelineCard {...defaultProps} />)

    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
  })

  it('uses muted secondary styling for the badge (W11)', () => {
    render(<TimelineCard {...defaultProps} source="MESSAGE" />)

    const badge = screen.getByText('Auto')
    expect(badge.className).toContain('bg-slate-100')
    expect(badge.className).toContain('text-slate-500')
  })
})
