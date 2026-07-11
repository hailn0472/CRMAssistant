import { render, screen } from '@testing-library/react'

import { ResponsiveTableWrapper } from '../ResponsiveTableWrapper'

describe('ResponsiveTableWrapper', () => {
  it('renders children inside a scrollable region', () => {
    render(
      <ResponsiveTableWrapper>
        <table>
          <tbody>
            <tr>
              <td>Data</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTableWrapper>,
    )

    const region = screen.getByRole('region', { name: 'Scrollable table' })
    expect(region).toBeInTheDocument()
    expect(region).toHaveTextContent('Data')
  })

  it('has overflow-x-auto for horizontal scrolling', () => {
    render(
      <ResponsiveTableWrapper>
        <table>
          <tbody>
            <tr>
              <td>Data</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTableWrapper>,
    )

    const region = screen.getByRole('region', { name: 'Scrollable table' })
    expect(region).toHaveClass('overflow-x-auto')
  })

  it('applies border and rounded styling', () => {
    render(
      <ResponsiveTableWrapper>
        <table>
          <tbody>
            <tr>
              <td>Data</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTableWrapper>,
    )

    const region = screen.getByRole('region', { name: 'Scrollable table' })
    expect(region).toHaveClass('rounded-lg', 'border', 'border-slate-200')
  })

  it('accepts additional className prop', () => {
    render(
      <ResponsiveTableWrapper className="extra-class">
        <table>
          <tbody>
            <tr>
              <td>Data</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTableWrapper>,
    )

    const region = screen.getByRole('region', { name: 'Scrollable table' })
    expect(region.parentElement).toHaveClass('extra-class')
  })

  it('is keyboard accessible with tabIndex', () => {
    render(
      <ResponsiveTableWrapper>
        <table>
          <tbody>
            <tr>
              <td>Data</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTableWrapper>,
    )

    const region = screen.getByRole('region', { name: 'Scrollable table' })
    expect(region).toHaveAttribute('tabIndex', '0')
  })

  it('sets up ResizeObserver to detect overflow', () => {
    const observeMock = jest.fn()
    const disconnectMock = jest.fn()
    const origResizeObserver = global.ResizeObserver

    global.ResizeObserver = class {
      observe = observeMock
      unobserve = jest.fn()
      disconnect = disconnectMock
    } as unknown as typeof ResizeObserver

    const { unmount } = render(
      <ResponsiveTableWrapper>
        <table>
          <tbody>
            <tr>
              <td>Data</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTableWrapper>,
    )

    expect(observeMock).toHaveBeenCalled()

    unmount()
    expect(disconnectMock).toHaveBeenCalled()

    global.ResizeObserver = origResizeObserver
  })
})
