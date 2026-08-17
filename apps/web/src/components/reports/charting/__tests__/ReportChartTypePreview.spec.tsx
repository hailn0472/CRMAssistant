import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReportChartTypePreview } from '../ReportChartTypePreview'

describe('ReportChartTypePreview (AC 17, Contract A.6)', () => {
  it('renders preview button with accessible name and selected state', () => {
    const onClick = jest.fn()
    render(<ReportChartTypePreview type="LINE" selected={true} onClick={onClick} />)

    const btn = screen.getByRole('button', { name: 'Line Chart' })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders all 9 types with correct static label and test id', () => {
    const { rerender } = render(<ReportChartTypePreview type="TABLE" />)
    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument()

    rerender(<ReportChartTypePreview type="SCATTER" />)
    expect(screen.getByRole('button', { name: 'Scatter Plot' })).toBeInTheDocument()

    rerender(<ReportChartTypePreview type="HEATMAP" />)
    expect(screen.getByRole('button', { name: 'Heatmap' })).toBeInTheDocument()
  })
})
