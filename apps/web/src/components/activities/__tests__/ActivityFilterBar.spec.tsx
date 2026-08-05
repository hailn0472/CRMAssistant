import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import {
  ActivityFilterBar,
  emptyActivityFilters,
  isActivityFilterActive,
  type ActivityFilters,
} from '../ActivityFilterBar'

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn().mockResolvedValue([]),
}))

function renderBar(
  filters: ActivityFilters = emptyActivityFilters,
  onFiltersChange: (f: ActivityFilters) => void = jest.fn(),
): { onFiltersChange: jest.Mock; rerender: ReturnType<typeof render>['rerender'] } {
  const mock = jest.fn(onFiltersChange)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ActivityFilterBar filters={filters} onFiltersChange={mock} />
    </QueryClientProvider>,
  )
  return { onFiltersChange: mock, rerender: view.rerender }
}

describe('ActivityFilterBar (Story 4.4, AC 23)', () => {
  it('renders search, the record-type toggle and the task controls by default', () => {
    renderBar()

    expect(screen.getByRole('textbox', { name: 'Search activities' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Record type' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Activities' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: /All statuses/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All priorities/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assignee/ })).toBeInTheDocument()
    // Activity-type control is hidden when the record type is Tasks.
    expect(screen.queryByRole('button', { name: /All activity types/ })).not.toBeInTheDocument()
  })

  it('switching to Activities hides task-only controls and reveals the activity type control', async () => {
    const user = userEvent.setup()
    const { onFiltersChange, rerender } = renderBar()

    await user.click(screen.getByRole('button', { name: 'Activities' }))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: 'activities',
        status: '',
        priority: '',
        assignee: null,
      }),
    )

    // Re-render with the new record type to observe the swapped controls.
    const activitiesFilters: ActivityFilters = { ...emptyActivityFilters, recordType: 'activities' }
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ActivityFilterBar filters={activitiesFilters} onFiltersChange={onFiltersChange} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: /All activity types/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /All statuses/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /All priorities/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assignee/ })).not.toBeInTheDocument()
  })

  it('search input updates the filter state immediately (debounce lives at the query site)', () => {
    const { onFiltersChange } = renderBar()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search activities' }), {
      target: { value: 'acme' },
    })

    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'acme' }))
  })

  it('status picker narrows via the FilterTrigger popover', async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = renderBar()

    await user.click(screen.getByRole('button', { name: /All statuses/ }))
    await user.click(await screen.findByText('In progress'))

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'IN_PROGRESS' }))
  })

  it('date range inputs update the filter state', async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = renderBar()

    await user.click(screen.getByRole('button', { name: /Date range/ }))
    const from = await screen.findByLabelText('Date range from')
    await user.type(from, '2026-08-01')

    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-01' }),
    )
  })

  it('Clear all resets every control but keeps the search term', async () => {
    const user = userEvent.setup()
    const active: ActivityFilters = {
      ...emptyActivityFilters,
      search: 'acme',
      status: 'TODO',
      priority: 'HIGH',
      assignee: { id: 'u1', name: 'Alice' },
      dateFrom: '2026-08-01',
    }
    const { onFiltersChange } = renderBar(active)

    await user.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyActivityFilters,
      search: 'acme',
    })
  })

  it('Clear all is hidden when no filter is active', () => {
    renderBar(emptyActivityFilters)
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
  })

  it('isActivityFilterActive ignores the record type and sort', () => {
    expect(isActivityFilterActive(emptyActivityFilters)).toBe(false)
    expect(
      isActivityFilterActive({
        ...emptyActivityFilters,
        sort: { field: 'DUE_DATE', direction: 'ASC' },
      }),
    ).toBe(false)
    expect(isActivityFilterActive({ ...emptyActivityFilters, activityType: 'CALL_MADE' })).toBe(
      true,
    )
    expect(isActivityFilterActive({ ...emptyActivityFilters, search: 'x' })).toBe(true)
  })
})
