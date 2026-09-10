import { act, render, screen } from '@testing-library/react'

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

  it('keeps the overflow affordance visible beyond mobile breakpoints', () => {
    let resizeCallback: ResizeObserverCallback = () => undefined
    const origResizeObserver = global.ResizeObserver

    global.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver

    const { container } = render(
      <ResponsiveTableWrapper>
        <table>
          <tbody>
            <tr>
              <td>Wide data</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTableWrapper>,
    )

    const region = screen.getByRole('region', { name: 'Scrollable table' })
    Object.defineProperty(region, 'clientWidth', { configurable: true, value: 320 })
    Object.defineProperty(region, 'scrollWidth', { configurable: true, value: 1050 })

    act(() => resizeCallback([], {} as ResizeObserver))

    const affordance = container.querySelector('[aria-hidden="true"]')
    expect(affordance).toBeInTheDocument()
    expect(affordance).not.toHaveClass('md:hidden')

    global.ResizeObserver = origResizeObserver
  })
})
