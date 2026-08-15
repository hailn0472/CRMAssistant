/**
 * Story 6.3 (AC 3): the builder page is a thin App Router page that renders
 * CustomReportBuilder without adding another QueryProvider (the dashboard
 * layout owns it — code-review invariant). Rendering the builder through the
 * page module proves the wiring.
 */
jest.mock('@/components/reports/CustomReportBuilder', () => ({
  CustomReportBuilder: () => <div data-testid="custom-report-builder">builder</div>,
}))

import { render, screen } from '@testing-library/react'

import CustomReportBuilderPage from '../builder/page'

describe('reports/builder page (AC 3)', () => {
  it('renders the CustomReportBuilder component', () => {
    render(<CustomReportBuilderPage />)
    expect(screen.getByTestId('custom-report-builder')).toBeInTheDocument()
  })
})
