import { render, screen } from '@testing-library/react'
import React from 'react'

import CustomerAnalyticsPageRoute from '../customer-analytics/page'

jest.mock('@/components/reports/CustomerAnalyticsPage', () => ({
  CustomerAnalyticsPage: () => <div data-testid="mock-customer-analytics-page" />,
}))

describe('CustomerAnalyticsPageRoute', () => {
  it('renders CustomerAnalyticsPage component', () => {
    render(<CustomerAnalyticsPageRoute />)
    expect(screen.getByTestId('mock-customer-analytics-page')).toBeInTheDocument()
  })
})
