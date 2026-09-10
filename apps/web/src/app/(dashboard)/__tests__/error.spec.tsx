import { render, screen, fireEvent } from '@testing-library/react'

import DashboardError from '../error'

describe('Dashboard Error Boundary', () => {
  it('renders an error state with accessible role="alert"', () => {
    const testError = new Error('Test error')
    const mockReset = jest.fn()

    render(<DashboardError error={testError} reset={mockReset} />)

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
  })

  it('retry button calls reset()', () => {
    const testError = new Error('Test error')
    const mockReset = jest.fn()

    render(<DashboardError error={testError} reset={mockReset} />)

    const retryButton = screen.getByRole('button', { name: /try again/i })
    fireEvent.click(retryButton)
    expect(mockReset).toHaveBeenCalledTimes(1)
  })

  it('renders an error message explaining what went wrong', () => {
    const testError = new Error('Data fetch failed')
    const mockReset = jest.fn()

    render(<DashboardError error={testError} reset={mockReset} />)

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })
})
