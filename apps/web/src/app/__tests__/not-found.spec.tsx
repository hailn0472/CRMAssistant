import { render, screen } from '@testing-library/react'

import NotFoundPage from '../not-found'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/nonexistent'),
}))

describe('Root Not Found Page', () => {
  it('renders "Page not found" heading', () => {
    render(<NotFoundPage />)

    expect(screen.getByText(/page not found/i)).toBeInTheDocument()
  })

  it('renders a CTA link back to the Command Center', () => {
    render(<NotFoundPage />)

    const link = screen.getByRole('link', { name: /command center/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/dashboard')
  })
})
