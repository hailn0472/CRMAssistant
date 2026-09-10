import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TaskMetricsCards } from '../TaskMetricsCards'
import { getTaskStats } from '@/services/task.service'

jest.mock('@/services/task.service', () => ({
  getTaskStats: jest.fn(),
}))

function renderCards(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TaskMetricsCards />
    </QueryClientProvider>,
  )
}

describe('TaskMetricsCards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the four workspace counters', async () => {
    ;(getTaskStats as jest.Mock).mockResolvedValue({
      openTasks: 168,
      dueToday: 6,
      overdue: 3,
      completedThisWeek: 42,
    })

    renderCards()

    expect(await screen.findByText('168')).toBeInTheDocument()
    expect(screen.getByText('Open tasks')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('Due today')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Completed this week')).toBeInTheDocument()
  })

  it('falls back to zeroes when the stats query fails', async () => {
    ;(getTaskStats as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderCards()

    expect(await screen.findByText('Open tasks')).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(4)
  })
})
