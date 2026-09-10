import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ImportPreview } from '../ImportPreview'
import type { PreviewRow } from '@/types/import-export.types'

describe('ImportPreview', () => {
  const mockRows: PreviewRow[] = [
    { rowNumber: 1, email: 'new@example.com', firstName: 'New', lastName: 'User', status: 'new' },
    {
      rowNumber: 2,
      email: 'dup@example.com',
      firstName: 'Dup',
      lastName: 'User',
      status: 'duplicate',
      existingContact: {
        id: 'c1',
        email: 'dup@example.com',
        firstName: 'Existing',
        lastName: 'User',
      },
    },
    {
      rowNumber: 3,
      email: '',
      firstName: 'No',
      lastName: 'Email',
      status: 'invalid',
      reason: 'Empty email',
    },
  ]

  const defaultProps = {
    totalRows: 100,
    newRows: 80,
    duplicateRows: 15,
    invalidRows: 5,
    previewRows: mockRows,
    strategy: 'skip' as const,
    onStrategyChange: jest.fn(),
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    isLoading: false,
  }

  it('renders summary card with correct counts', () => {
    render(<ImportPreview {...defaultProps} />)
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders strategy selector with three options', () => {
    render(<ImportPreview {...defaultProps} />)
    expect(screen.getByLabelText(/skip/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/update/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/create new/i)).toBeInTheDocument()
  })

  it('has Skip selected by default', () => {
    render(<ImportPreview {...defaultProps} />)
    const skipRadio = screen.getByLabelText(/skip/i) as HTMLInputElement
    expect(skipRadio.checked).toBe(true)
  })

  it('renders preview table with status badges', () => {
    render(<ImportPreview {...defaultProps} />)
    // "New" and "Invalid" appear both in summary labels and as badges — use getAllByText
    expect(screen.getAllByText('New').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Duplicate')).toBeInTheDocument()
    expect(screen.getAllByText('Invalid').length).toBeGreaterThanOrEqual(1)
  })

  it('calls onConfirm when confirm button clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(<ImportPreview {...defaultProps} onConfirm={onConfirm} />)
    await user.click(screen.getByText('Confirm & Import'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = jest.fn()
    render(<ImportPreview {...defaultProps} onCancel={onCancel} />)
    await user.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('disables confirm button when loading', () => {
    render(<ImportPreview {...defaultProps} isLoading={true} />)
    expect(screen.getByText('Importing...')).toBeDisabled()
  })

  describe('duplicate and invalid details', () => {
    it('shows the existing contact for a duplicate row so the user can compare', () => {
      // AC 8: without this the user picks a resolution strategy blind.
      render(<ImportPreview {...defaultProps} />)

      expect(screen.getByText('Existing User')).toBeInTheDocument()
      expect(screen.getByText(/<dup@example\.com>/)).toBeInTheDocument()
    })

    it('shows the rejection reason for an invalid row', () => {
      render(<ImportPreview {...defaultProps} />)

      expect(screen.getByText('Empty email')).toBeInTheDocument()
    })

    it('reports how many of the total rows are being shown', () => {
      render(<ImportPreview {...defaultProps} />)

      expect(screen.getByText('Preview (3 of 100 rows)')).toBeInTheDocument()
      expect(
        screen.getByText(/Showing the first 3 rows in file order\. All 100 rows will be processed/),
      ).toBeInTheDocument()
    })

    it('renders at most ten rows', () => {
      const many: PreviewRow[] = Array.from({ length: 25 }, (_, i) => ({
        rowNumber: i + 2,
        email: `u${i}@example.com`,
        firstName: 'A',
        lastName: 'B',
        status: 'new' as const,
      }))

      render(<ImportPreview {...defaultProps} previewRows={many} />)

      expect(screen.getAllByText('New')).toHaveLength(11) // 10 badges + summary label
    })
  })
})
