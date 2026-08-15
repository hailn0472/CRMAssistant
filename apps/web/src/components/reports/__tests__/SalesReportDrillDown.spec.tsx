/**
 * Story 6.2 (AC 53, 74, 79-80): drill-down panel — scope toggle, pagination,
 * semantic table, links, and loading/error/empty states.
 */
import { fireEvent, render, screen } from '@testing-library/react'

import { SalesReportDrillDown } from '../SalesReportDrillDown'
import type { ReportDrillConnection } from '@/services/sales-report.service'

const DRILL: ReportDrillConnection = {
  items: [
    {
      id: 'deal-1',
      title: 'Acme renewal',
      value: 1000,
      currency: 'USD',
      probability: 50,
      stageId: 'stage-1',
      stageName: 'Proposal',
      contactId: 'contact-1',
      contactName: 'Grace Hopper',
      ownerId: 'user-1',
      ownerName: 'Ada Lovelace',
      teamId: 'team-1',
      teamName: 'North',
      productNames: ['CRM'],
      createdAt: '2026-07-01T00:00:00.000Z',
      expectedCloseDate: '2026-08-31T00:00:00.000Z',
      actualCloseDate: '2026-08-15T00:00:00.000Z',
      dealHref: '/deals/deal-1',
      contactHref: '/contacts/contact-1',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
}

function renderDrill(
  overrides: Partial<Parameters<typeof SalesReportDrillDown>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <SalesReportDrillDown
      open
      onOpenChange={jest.fn()}
      metricLabel="WON_DEALS"
      currency="USD"
      drill={DRILL}
      isLoading={false}
      error={null}
      scope="CURRENT"
      onScopeChange={jest.fn()}
      onPageChange={jest.fn()}
      hasComparison
      {...overrides}
    />,
  )
}

describe('SalesReportDrillDown (AC 74)', () => {
  it('renders the dialog with a semantic table, links and total count', () => {
    renderDrill()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Underlying deals/ })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Acme renewal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Acme renewal/ })).toHaveAttribute(
      'href',
      '/deals/deal-1',
    )
    expect(screen.getByRole('link', { name: 'Grace Hopper' })).toHaveAttribute(
      'href',
      '/contacts/contact-1',
    )
    expect(screen.getByText('1 deal found')).toBeInTheDocument()
  })

  it('offers Current/Comparison scope toggle with aria-pressed (AC 53)', () => {
    const onScopeChange = jest.fn()
    renderDrill({ onScopeChange, scope: 'CURRENT' })

    const comparisonButton = screen.getByRole('button', { name: 'Comparison period' })
    expect(comparisonButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(comparisonButton)
    expect(onScopeChange).toHaveBeenCalledWith('COMPARISON')
  })

  it('hides the Comparison scope option when no comparison period is configured (AC 53/74, finding #6)', () => {
    const onScopeChange = jest.fn()
    renderDrill({ hasComparison: false, scope: 'COMPARISON', onScopeChange })

    expect(screen.queryByRole('button', { name: 'Comparison period' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Current period' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // No COMPARISON button means no path to request an unavailable scope.
    fireEvent.click(screen.getByRole('button', { name: 'Current period' }))
    expect(onScopeChange).toHaveBeenCalledWith('CURRENT')
  })

  it('paginates with Previous disabled on the first page', () => {
    const onPageChange = jest.fn()
    renderDrill({ onPageChange })

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Next page' })
    expect(next).toBeDisabled()
    fireEvent.click(next)
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('enables pagination when there are more rows', () => {
    const onPageChange = jest.fn()
    renderDrill({
      drill: { ...DRILL, total: 45, page: 1, pageSize: 20 },
      onPageChange,
    })

    const next = screen.getByRole('button', { name: 'Next page' })
    expect(next).not.toBeDisabled()
    fireEvent.click(next)
    expect(onPageChange).toHaveBeenCalledWith(2)
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('shows a loading skeleton while loading without data', () => {
    renderDrill({ drill: null, isLoading: true })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows an empty state when no rows match', () => {
    renderDrill({ drill: { items: [], total: 0, page: 1, pageSize: 20 } })
    expect(screen.getByText('No underlying deals')).toBeInTheDocument()
  })

  it('shows an error state with a retry action', () => {
    const onPageChange = jest.fn()
    renderDrill({ drill: null, error: 'GraphQL failure', onPageChange })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('GraphQL failure')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onPageChange).toHaveBeenCalled()
  })

  it('renders a hidden caption for assistive tech', () => {
    renderDrill()
    expect(
      screen.getByText(/Underlying deals for WON_DEALS in the current period/i),
    ).toBeInTheDocument()
  })
})
