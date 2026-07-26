import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ImportResult } from '../ImportResult'

const mockRouter = {
  push: jest.fn(),
}

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

describe('ImportResult', () => {
  const defaultProps = {
    imported: 450,
    skipped: 48,
    updated: 0,
    failed: 2,
    _totalRows: 500,
    duration: 12450,
    onImportAnother: jest.fn(),
  }

  it('renders result summary with final counts', () => {
    render(<ImportResult {...defaultProps} />)
    expect(screen.getByText('450')).toBeInTheDocument()
    expect(screen.getByText('48')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('displays duration', () => {
    render(<ImportResult {...defaultProps} />)
    expect(screen.getByText(/12\./)).toBeInTheDocument()
    expect(screen.getByText(/seconds/)).toBeInTheDocument()
  })

  it('renders View Contacts button', () => {
    render(<ImportResult {...defaultProps} />)
    expect(screen.getByText('View Contacts')).toBeInTheDocument()
  })

  it('renders Import Another File button', () => {
    render(<ImportResult {...defaultProps} />)
    expect(screen.getByText('Import Another File')).toBeInTheDocument()
  })

  it('calls onImportAnother when button clicked', async () => {
    const user = userEvent.setup()
    const onImportAnother = jest.fn()
    render(<ImportResult {...defaultProps} onImportAnother={onImportAnother} />)
    await user.click(screen.getByText('Import Another File'))
    expect(onImportAnother).toHaveBeenCalledTimes(1)
  })

  it('navigates to /contacts when View Contacts clicked', async () => {
    const user = userEvent.setup()
    render(<ImportResult {...defaultProps} />)
    await user.click(screen.getByText('View Contacts'))
    expect(mockRouter.push).toHaveBeenCalledWith('/contacts')
  })
})
