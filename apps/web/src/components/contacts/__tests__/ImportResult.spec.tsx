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
    totalRows: 500,
    duration: 12500,
    onImportAnother: jest.fn(),
  }

  it('renders result summary with final counts', () => {
    render(<ImportResult {...defaultProps} />)
    expect(screen.getByText('450')).toBeInTheDocument()
    expect(screen.getByText('48')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('displays the total rows processed and the duration', () => {
    const { container } = render(<ImportResult {...defaultProps} />)
    // The sentence is built from several JSX expressions, so assert on the
    // element's combined text rather than a single text node.
    expect(container.textContent).toContain('Processed 500 rows in 12.5 seconds')
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

  describe('failed rows', () => {
    it('lists the rows that could not be imported', () => {
      // A failure count with no detail leaves the user nothing to act on.
      render(
        <ImportResult
          {...defaultProps}
          errors={[
            { row: 42, reason: 'Invalid email format' },
            { row: 57, reason: 'Missing firstName' },
          ]}
          failed={2}
        />,
      )

      expect(screen.getByText('2 rows could not be imported')).toBeInTheDocument()
      expect(screen.getByText('Line 42: Invalid email format')).toBeInTheDocument()
      expect(screen.getByText('Line 57: Missing firstName')).toBeInTheDocument()
    })

    it('omits the line prefix for file-level errors', () => {
      render(
        <ImportResult
          {...defaultProps}
          errors={[{ row: 0, reason: '3 duplicate row(s) within the file were ignored' }]}
          failed={1}
        />,
      )

      expect(
        screen.getByText('3 duplicate row(s) within the file were ignored'),
      ).toBeInTheDocument()
    })

    it('collapses a long error list behind a show-all control', async () => {
      const user = userEvent.setup()
      const errors = Array.from({ length: 15 }, (_, i) => ({
        row: i + 2,
        reason: 'Invalid email format',
      }))

      render(<ImportResult {...defaultProps} errors={errors} failed={15} />)

      expect(screen.getAllByText(/^Line \d+:/)).toHaveLength(10)

      await user.click(screen.getByText('Show all 15 errors'))

      expect(screen.getAllByText(/^Line \d+:/)).toHaveLength(15)
    })

    it('renders no error panel when nothing failed', () => {
      render(<ImportResult {...defaultProps} failed={0} errors={[]} />)

      expect(screen.queryByText(/could not be imported/)).not.toBeInTheDocument()
    })
  })
})
