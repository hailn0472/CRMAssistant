'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { searchUsers } from '@/services/owner.service'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '@/lib/task-format'
import type { TaskPriority, TaskStatus } from '@/lib/task-format'
import { cn } from '@/lib/utils'

export type TaskFilters = {
  search: string
  status: TaskStatus | ''
  priority: TaskPriority | ''
  assignee: { id: string; name: string } | null
  mineOnly: boolean
}

export const emptyTaskFilters: TaskFilters = {
  search: '',
  status: '',
  priority: '',
  assignee: null,
  mineOnly: false,
}

type TaskFilterBarProps = {
  filters: TaskFilters
  onFiltersChange: (filters: TaskFilters) => void
  /** Rendered at the far right of the toolbar row — e.g. the result count. */
  trailing?: React.ReactNode
}

const triggerClass =
  'inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-[12.5px] font-medium transition-colors'

function FilterTrigger({
  label,
  value,
  active,
  children,
}: {
  label: string
  value?: string
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          triggerClass,
          active
            ? 'border-[#1b1b1f] bg-[#fafafb] text-[#1b1b1f]'
            : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:bg-[#f4f4f6]',
        )}
      >
        {active && value ? `${label}: ${value}` : label}
        <span className="text-[9px] text-[#b4b4bd]">▾</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        {children}
      </PopoverContent>
    </Popover>
  )
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

function AssigneeFilter({
  filters,
  onFiltersChange,
}: {
  filters: TaskFilters
  onFiltersChange: (filters: TaskFilters) => void
}): React.JSX.Element {
  const [term, setTerm] = useState('')

  const { data: users = [] } = useQuery({
    queryKey: ['task-assignee-options', term],
    queryFn: () => searchUsers(term),
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

export function TaskFilterBar({
  filters,
  onFiltersChange,
  trailing,
}: TaskFilterBarProps): React.JSX.Element {
  const hasActiveFilters =
    filters.status !== '' ||
    filters.priority !== '' ||
    filters.assignee !== null ||
    filters.mineOnly

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[#f2f2f5] px-[18px] py-3.5">
      <div className="flex h-[34px] w-[250px] max-w-full items-center gap-[9px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-[11px] transition-colors focus-within:border-[#c7c7d1] focus-within:bg-white">
        <span className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[#a0a0aa]" />
        <input
          type="text"
          aria-label="Search tasks"
          placeholder="Search tasks"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#1b1b1f] outline-none placeholder:text-[#9b9ba3]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
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

        <label className="flex h-[34px] cursor-pointer items-center gap-[7px] rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]">
          <input
            type="checkbox"
            checked={filters.mineOnly}
            onChange={(e) => onFiltersChange({ ...filters, mineOnly: e.target.checked })}
            className="h-[14px] w-[14px] accent-[#1b1b1f]"
          />
          My tasks only
        </label>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...emptyTaskFilters, search: filters.search })}
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
