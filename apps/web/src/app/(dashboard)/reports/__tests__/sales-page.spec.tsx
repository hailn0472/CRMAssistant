/**
 * Story 6.2 (AC 64): thin page specs — /reports redirects to /reports/sales
 * and /reports/sales renders the workspace without its own QueryProvider.
 */
jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}))

import { redirect } from 'next/navigation'

const mockRedirect = redirect as unknown as jest.Mock

describe('/reports page (AC 64)', () => {
  it('redirects to /reports/sales', async () => {
    mockRedirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })
    const { default: ReportsPage } = await import('../page')
    expect(() => ReportsPage()).toThrow('NEXT_REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/reports/sales')
  })
})

jest.mock('@/components/reports/SalesReportsWorkspace', () => ({
  SalesReportsWorkspace: () => <div data-testid="sales-reports-workspace" />,
}))

import { render, screen } from '@testing-library/react'

describe('/reports/sales page (AC 64)', () => {
  it('renders SalesReportsWorkspace', async () => {
    const { default: SalesReportsPage } = await import('../sales/page')
    render(<SalesReportsPage />)
    expect(screen.getByTestId('sales-reports-workspace')).toBeInTheDocument()
  })
})
