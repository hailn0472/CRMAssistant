import { render, screen } from '@testing-library/react'

import { ImportProgress } from '../ImportProgress'

describe('ImportProgress', () => {
  const defaultProps = {
    currentBatch: 3,
    totalBatches: 10,
    imported: 243,
    skipped: 5,
    updated: 0,
    failed: 2,
    totalRows: 1000,
  }

  it('displays batch counter text', () => {
    render(<ImportProgress {...defaultProps} />)
    expect(screen.getByText(/Batch 3\/10/)).toBeInTheDocument()
  })

  it('displays live counters for all categories', () => {
    render(<ImportProgress {...defaultProps} />)
    expect(screen.getByText('243')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders progress bar', () => {
    render(<ImportProgress {...defaultProps} />)
    // Progress bar should exist
    const progressBar = document.querySelector('.bg-blue-600')
    expect(progressBar).toBeInTheDocument()
  })
})
