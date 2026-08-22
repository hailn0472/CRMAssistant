import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ActivityGoalDialog } from '../ActivityGoalDialog'
import * as activityReportService from '@/services/activity-report.service'
import toast from 'react-hot-toast'

jest.mock('@/services/activity-report.service', () => ({
  ...jest.requireActual('@/services/activity-report.service'),
  createActivityGoal: jest.fn(),
  updateActivityGoal: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockedCreateGoal = activityReportService.createActivityGoal as jest.MockedFunction<
  typeof activityReportService.createActivityGoal
>
const mockedUpdateGoal = activityReportService.updateActivityGoal as jest.MockedFunction<
  typeof activityReportService.updateActivityGoal
>

describe('ActivityGoalDialog', () => {
  let queryClient: QueryClient
  const users = [
    { id: 'u1', firstName: 'Alice', lastName: 'Smith' },
    { id: 'u2', firstName: 'Bob', lastName: 'Jones' },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  function renderDialog(props = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <ActivityGoalDialog
          open={true}
          onOpenChange={jest.fn()}
          users={users}
          currentUserId="u1"
          {...props}
        />
      </QueryClientProvider>,
    )
  }

  it('renders create mode with proper fields', () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: 'Create Activity Goal' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Goal Name/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Activity Type' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Target Count/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Period' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument()
  })

  it('submits create goal successfully', async () => {
    mockedCreateGoal.mockResolvedValueOnce({
      id: 'g1',
      name: '50 calls',
      activityType: 'CALL_MADE',
      targetCount: 50,
      period: 'WEEKLY',
      userId: 'u1',
      startsOn: '2026-08-22T00:00:00.000Z',
      isActive: true,
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      qualifyingCount: 0,
      progress: 0,
      progressPercent: 0,
    })

    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })

    fireEvent.change(screen.getByLabelText(/Goal Name/i), { target: { value: '50 calls' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Activity Type' }), {
      target: { value: 'CALL_MADE' },
    })
    fireEvent.change(screen.getByLabelText(/Target Count/i), { target: { value: '50' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create Goal' }))

    await waitFor(() => {
      expect(mockedCreateGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '50 calls',
          activityType: 'CALL_MADE',
          targetCount: 50,
          period: 'WEEKLY',
          userId: 'u1',
        }),
      )
      expect(toast.success).toHaveBeenCalledWith('Activity goal created successfully')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('renders edit mode and submits update goal', async () => {
    const goal = {
      id: 'g1',
      name: '50 calls',
      activityType: 'CALL_MADE' as const,
      targetCount: 50,
      period: 'WEEKLY' as const,
      userId: 'u1',
      startsOn: '2026-08-22T00:00:00.000Z',
      isActive: true,
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      qualifyingCount: 20,
      progress: 0.4,
      progressPercent: 40,
    }

    mockedUpdateGoal.mockResolvedValueOnce({ ...goal, targetCount: 60 })

    const onOpenChange = jest.fn()
    renderDialog({ goal, onOpenChange })

    expect(screen.getByRole('heading', { name: 'Edit Activity Goal' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Target Count/i), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update Goal' }))

    await waitFor(() => {
      expect(mockedUpdateGoal).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({
          targetCount: 60,
        }),
      )
      expect(toast.success).toHaveBeenCalledWith('Activity goal updated successfully')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
