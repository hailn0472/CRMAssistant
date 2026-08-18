import { render, screen } from '@testing-library/react'
import React from 'react'

import ReportExportsPageRoute from '../exports/page'

jest.mock('@/components/reports/ReportExportsPage', () => ({
  ReportExportsPage: () => <div data-testid="mock-report-exports-page" />,
}))

describe('ReportExportsPageRoute', () => {
  it('renders ReportExportsPage component', () => {
    render(<ReportExportsPageRoute />)
    expect(screen.getByTestId('mock-report-exports-page')).toBeInTheDocument()
  })
})
