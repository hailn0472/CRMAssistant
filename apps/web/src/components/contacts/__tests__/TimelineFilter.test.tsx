import { render, screen, fireEvent } from '@testing-library/react'
import { TimelineFilter } from '../TimelineFilter'

describe('TimelineFilter', () => {
  const mockOnFilterChange = jest.fn()

  beforeEach(() => {
    mockOnFilterChange.mockClear()
  })

  it('renders all three filter options', () => {
    render(<TimelineFilter activeFilter="ALL" onFilterChange={mockOnFilterChange} />)
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
  })

  it('highlights the active filter (ALL)', () => {
    render(<TimelineFilter activeFilter="ALL" onFilterChange={mockOnFilterChange} />)
    const allButton = screen.getByText('All')
    expect(allButton.className).toContain('bg-white')
    expect(allButton.className).toContain('border-[#e6e6eb]')
  })

  it('highlights the active filter (SALES)', () => {
    render(<TimelineFilter activeFilter="SALES" onFilterChange={mockOnFilterChange} />)
    const salesButton = screen.getByText('Sales')
    expect(salesButton.className).toContain('bg-white')
    expect(salesButton.className).toContain('border-[#e6e6eb]')
  })

  it('highlights the active filter (SYSTEM)', () => {
    render(<TimelineFilter activeFilter="SYSTEM" onFilterChange={mockOnFilterChange} />)
    const systemButton = screen.getByText('System')
    expect(systemButton.className).toContain('bg-white')
    expect(systemButton.className).toContain('border-[#e6e6eb]')
  })

  it('calls onFilterChange when "Sales" is clicked', () => {
    render(<TimelineFilter activeFilter="ALL" onFilterChange={mockOnFilterChange} />)
    fireEvent.click(screen.getByText('Sales'))
    expect(mockOnFilterChange).toHaveBeenCalledWith('SALES')
  })

  it('calls onFilterChange when "System" is clicked', () => {
    render(<TimelineFilter activeFilter="ALL" onFilterChange={mockOnFilterChange} />)
    fireEvent.click(screen.getByText('System'))
    expect(mockOnFilterChange).toHaveBeenCalledWith('SYSTEM')
  })

  it('calls onFilterChange when "All" is clicked while another filter is active', () => {
    render(<TimelineFilter activeFilter="SALES" onFilterChange={mockOnFilterChange} />)
    fireEvent.click(screen.getByText('All'))
    expect(mockOnFilterChange).toHaveBeenCalledWith('ALL')
  })

  it('non-active filters do not have the active styling', () => {
    render(<TimelineFilter activeFilter="ALL" onFilterChange={mockOnFilterChange} />)
    const salesButton = screen.getByText('Sales')
    const systemButton = screen.getByText('System')
    expect(salesButton.className).toContain('border-transparent')
    expect(systemButton.className).toContain('border-transparent')
  })
})
