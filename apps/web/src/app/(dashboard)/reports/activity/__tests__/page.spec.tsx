import { render, screen } from '@testing-library/react'
import ActivityReportsRoutePage from '../page'

jest.mock('@/components/reports/ActivityReportsPage', () => ({
  ActivityReportsPage: () => (
    <div data-testid="mock-activity-reports-page">Activity Reports Page</div>
  ),
}))

describe('ActivityReportsRoutePage', () => {
  it('renders ActivityReportsPage wrapped inside QueryProvider', () => {
    render(<ActivityReportsRoutePage />)
    expect(screen.getByTestId('mock-activity-reports-page')).toBeInTheDocument()
  })
})
