import { render, screen, fireEvent } from '@testing-library/react'

import { ErrorState } from '../ErrorState'

describe('ErrorState', () => {
  it('renders default title when no title prop is passed', () => {
    render(<ErrorState message="Could not load the data." />)

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Could not load the data.')).toBeInTheDocument()
  })

  it('renders custom title when provided', () => {
    render(<ErrorState title="Contact load failed" message="The server returned a 500 error." />)

    expect(screen.getByText('Contact load failed')).toBeInTheDocument()
  })

  it('renders retry button when onRetry is provided; fires callback on click', () => {
    const onRetry = jest.fn()

    render(<ErrorState message="Network error." onRetry={onRetry} />)

    const retryButton = screen.getByRole('button', { name: /try again/i })
    expect(retryButton).toBeInTheDocument()

    fireEvent.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('has role="alert" for screen reader announcement (WCAG)', () => {
    const { container } = render(<ErrorState message="Something went wrong." />)

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert).toBeInTheDocument()
  })

  it('renders a fallback message when message is empty', () => {
    render(<ErrorState message="" />)

    expect(screen.getByText(/an unexpected error occurred/i)).toBeInTheDocument()
  })
})
