'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Input } from '@/components/ui/input'
import { searchUsers } from '@/services/owner.service'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/task-format'
import type { ActivityTypeValue } from '@/types/activity.types'
import { ACTIVITY_TYPE_LABELS } from '@/types/activity.types'
import type { TaskSort } from '@/services/task.service'
import { FilterTrigger } from '@/components/shared/FilterTrigger'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

export type ActivityRecordType = 'tasks' | 'activities'

/**
 * Shared workspace filter state (AC 21/23): lives ABOVE the tab control and is
 * passed down to every view, so switching List → Calendar → Timeline never
 * resets a filter. Task-only controls are hidden when the record type is
 * Activities and vice-versa — never disabled-and-confusing (AC 23).
 */
export type ActivityFilters = {
  search: string
  recordType: ActivityRecordType
  status: TaskStatus | ''
  priority: TaskPriority | ''
  assignee: { id: string; name: string } | null
  activityType: ActivityTypeValue | ''
  dateFrom: string
  dateTo: string
  /** List-view sort (AC 12/26) — part of the shared state, read only by the List view. */
  sort: TaskSort | null
}

export const emptyActivityFilters: ActivityFilters = {
  search: '',
  recordType: 'tasks',
  status: '',
  priority: '',
  assignee: null,
  activityType: '',
  dateFrom: '',
  dateTo: '',
  sort: null,
}

/** True when any non-record-type filter is active — drives the empty-vs-filtered-empty distinction (AC 27). */
export function isActivityFilterActive(filters: ActivityFilters): boolean {
  return (
    filters.search !== '' ||
    filters.status !== '' ||
    filters.priority !== '' ||
    filters.assignee !== null ||
    filters.activityType !== '' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== ''
  )
}

type ActivityFilterBarProps = {
  filters: ActivityFilters
  onFiltersChange: (filters: ActivityFilters) => void
  /** Rendered at the far right of the toolbar row — e.g. the result count. */
  trailing?: React.ReactNode
}

function OptionList<T extends string>({
  options,
  labels,
  selected,
  onSelect,
}: {
  options: readonly T[]
  labels: Record<T, string>
  selected: T | ''
  onSelect: (value: T | '') => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onSelect('')}
        className={cn(
          'rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
          selected === '' ? 'font-medium text-[#1b1b1f]' : 'text-[#4b4b55]',
        )}
      >
        All
      </button>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onSelect(option)}
          className={cn(
            'rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
            selected === option ? 'font-medium text-[#1b1b1f]' : 'text-[#4b4b55]',
          )}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  )
}

const ACTIVITY_TYPE_OPTIONS = Object.keys(ACTIVITY_TYPE_LABELS) as ActivityTypeValue[]

function AssigneeFilter({
  filters,
  onFiltersChange,
}: {
  filters: ActivityFilters
  onFiltersChange: (filters: ActivityFilters) => void
}): React.JSX.Element {
  const [term, setTerm] = useState('')
  const debouncedTerm = useDebounce(term, 300)

  const { data: users = [] } = useQuery({
    queryKey: ['task-assignee-options', debouncedTerm],
    queryFn: () => searchUsers(debouncedTerm),
  })

  return (
    <FilterTrigger
      label="Assignee"
      value={filters.assignee?.name}
      active={filters.assignee !== null}
    >
      <div className="flex flex-col gap-2">
        <Input
          className="h-8 text-xs"
          placeholder="Search people..."
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="max-h-56 overflow-y-auto">
          {users.length === 0 ? (
            <p className="px-1 py-2 text-xs text-[#a0a0aa]">No people found.</p>
          ) : (
            users.map((user) => {
              const name = `${user.firstName} ${user.lastName}`.trim()
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, assignee: { id: user.id, name } })}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
                    filters.assignee?.id === user.id ? 'text-[#1b1b1f]' : 'text-[#4b4b55]',
                  )}
                >
                  <span className="truncate">{name || user.email}</span>
                </button>
              )
            })
          )}
        </div>
        {filters.assignee ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, assignee: null })}
            className="self-start text-[11.5px] text-[#8c8c96] hover:text-[#1b1b1f]"
          >
            Clear assignee
          </button>
        ) : null}
      </div>
    </FilterTrigger>
  )
}

function DateRangeFilter({
  filters,
  onFiltersChange,
}: {
  filters: ActivityFilters
  onFiltersChange: (filters: ActivityFilters) => void
}): React.JSX.Element {
  const value =
    filters.dateFrom && filters.dateTo
      ? `${filters.dateFrom} → ${filters.dateTo}`
      : filters.dateFrom
        ? `From ${filters.dateFrom}`
        : filters.dateTo
          ? `To ${filters.dateTo}`
          : undefined
  return (
    <FilterTrigger
      label="Date range"
      value={value}
      active={filters.dateFrom !== '' || filters.dateTo !== ''}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[11.5px] font-medium text-[#8c8c96]">
          From
          <input
            type="date"
            aria-label="Date range from"
            value={filters.dateFrom}
            onChange={(e) => onFiltersChange({ ...filters, dateFrom: e.target.value })}
            className="h-8 rounded-[8px] border border-[#e6e6eb] bg-white px-2 text-[12.5px] text-[#1b1b1f] outline-none focus:border-[#c7c7d1]"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[11.5px] font-medium text-[#8c8c96]">
          To
          <input
            type="date"
            aria-label="Date range to"
            value={filters.dateTo}
            onChange={(e) => onFiltersChange({ ...filters, dateTo: e.target.value })}
            className="h-8 rounded-[8px] border border-[#e6e6eb] bg-white px-2 text-[12.5px] text-[#1b1b1f] outline-none focus:border-[#c7c7d1]"
          />
        </label>
        {(filters.dateFrom !== '' || filters.dateTo !== '') && (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, dateFrom: '', dateTo: '' })}
            className="self-start text-[11.5px] text-[#8c8c96] hover:text-[#1b1b1f]"
          >
            Clear dates
          </button>
        )}
      </div>
    </FilterTrigger>
  )
}

export function ActivityFilterBar({
  filters,
  onFiltersChange,
  trailing,
}: ActivityFilterBarProps): React.JSX.Element {
  const showTaskControls = filters.recordType === 'tasks'
  const hasActiveFilters = isActivityFilterActive(filters)

  function setRecordType(recordType: ActivityRecordType): void {
    if (recordType === filters.recordType) return
    // Reset the controls that do not apply to the other record type so a
    // stale task status never silently leaks into the activity feed.
    onFiltersChange({
      ...filters,
      recordType,
      status: '',
      priority: '',
      assignee: null,
      activityType: '',
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-t-2xl border-b border-[#f2f2f5] bg-white px-[18px] py-3.5">
      <div className="flex h-[34px] w-[250px] max-w-full items-center gap-[9px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-[11px] transition-colors focus-within:border-[#c7c7d1] focus-within:bg-white">
        <span className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[#a0a0aa]" />
        <input
          type="text"
          aria-label="Search activities"
          placeholder="Search"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#1b1b1f] outline-none placeholder:text-[#9b9ba3]"
        />
      </div>

      {/* Record-type segmented control (AC 23): Tasks | Activities. */}
      <div
        role="group"
        aria-label="Record type"
        className="flex h-[34px] items-center rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] p-[3px]"
      >
        <button
          type="button"
          aria-pressed={filters.recordType === 'tasks'}
          onClick={() => setRecordType('tasks')}
          className={cn(
            'h-[26px] rounded-[7px] px-3 text-[12.5px] font-medium transition-colors',
            filters.recordType === 'tasks'
              ? 'bg-[#1b1b1f] text-white shadow-sm'
              : 'text-[#4b4b55] hover:bg-[#f4f4f6]',
          )}
        >
          Tasks
        </button>
        <button
          type="button"
          aria-pressed={filters.recordType === 'activities'}
          onClick={() => setRecordType('activities')}
          className={cn(
            'h-[26px] rounded-[7px] px-3 text-[12.5px] font-medium transition-colors',
            filters.recordType === 'activities'
              ? 'bg-[#1b1b1f] text-white shadow-sm'
              : 'text-[#4b4b55] hover:bg-[#f4f4f6]',
          )}
        >
          Activities
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {showTaskControls ? (
          <>
            <FilterTrigger
              label="All statuses"
              value={filters.status ? TASK_STATUS_LABELS[filters.status] : undefined}
              active={filters.status !== ''}
            >
              <OptionList
                options={TASK_STATUSES}
                labels={TASK_STATUS_LABELS}
                selected={filters.status}
                onSelect={(status) => onFiltersChange({ ...filters, status })}
              />
            </FilterTrigger>

            <FilterTrigger
              label="All priorities"
              value={filters.priority ? TASK_PRIORITY_LABELS[filters.priority] : undefined}
              active={filters.priority !== ''}
            >
              <OptionList
                options={TASK_PRIORITIES}
                labels={TASK_PRIORITY_LABELS}
                selected={filters.priority}
                onSelect={(priority) => onFiltersChange({ ...filters, priority })}
              />
            </FilterTrigger>

            <AssigneeFilter filters={filters} onFiltersChange={onFiltersChange} />
          </>
        ) : (
          <FilterTrigger
            label="All activity types"
            value={filters.activityType ? ACTIVITY_TYPE_LABELS[filters.activityType] : undefined}
            active={filters.activityType !== ''}
          >
            <div className="max-h-64 overflow-y-auto">
              <OptionList
                options={ACTIVITY_TYPE_OPTIONS}
                labels={ACTIVITY_TYPE_LABELS}
                selected={filters.activityType}
                onSelect={(activityType) => onFiltersChange({ ...filters, activityType })}
              />
            </div>
          </FilterTrigger>
        )}

        <DateRangeFilter filters={filters} onFiltersChange={onFiltersChange} />

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...emptyActivityFilters, search: filters.search })}
            className="px-1.5 text-[12px] text-[#8c8c96] transition-colors hover:text-[#1b1b1f]"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  )
}
