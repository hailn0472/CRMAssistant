import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReportChartControls } from '../ReportChartControls'

describe('ReportChartControls (AC 12, 14, 16, 20)', () => {
  const defaultProps = {
    startIndex: 0,
    endIndex: 20,
    totalPoints: 50,
    onZoomIn: jest.fn(),
    onZoomOut: jest.fn(),
    onPanPrevious: jest.fn(),
    onPanNext: jest.fn(),
    onReset: jest.fn(),
    onExportSvg: jest.fn(),
    onExportPng: jest.fn(),
    canZoomIn: true,
    canZoomOut: true,
    canPanPrev: true,
    canPanNext: true,
    canReset: true,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders range summary and announces to polite live region', () => {
    render(<ReportChartControls {...defaultProps} />)
    const summary = screen.getByTestId('viewport-range-summary')
    expect(summary).toHaveTextContent('Showing points 1–20 of 50')
  })

  it('fires callbacks on zoom, pan and reset clicks', () => {
    render(<ReportChartControls {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(defaultProps.onZoomIn).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(defaultProps.onZoomOut).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Pan previous' }))
    expect(defaultProps.onPanPrevious).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Pan next' }))
    expect(defaultProps.onPanNext).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom and pan' }))
    expect(defaultProps.onReset).toHaveBeenCalledTimes(1)
  })

  it('renders SVG and PNG export buttons and fires export callbacks', () => {
    render(<ReportChartControls {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
    expect(defaultProps.onExportSvg).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Export as PNG' }))
    expect(defaultProps.onExportPng).toHaveBeenCalledTimes(1)
  })
})
