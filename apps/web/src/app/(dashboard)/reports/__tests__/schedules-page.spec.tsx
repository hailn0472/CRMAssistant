import { render, screen } from '@testing-library/react'
import React from 'react'

import SchedulesPageRoute from '../schedules/page'

jest.mock('@/components/reports/ReportSchedulesPage', () => ({
  ReportSchedulesPage: () => <div data-testid="mock-report-schedules-page" />,
}))

describe('SchedulesPageRoute', () => {
  it('renders ReportSchedulesPage component', () => {
    render(<SchedulesPageRoute />)
    expect(screen.getByTestId('mock-report-schedules-page')).toBeInTheDocument()
  })
})
