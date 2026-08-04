'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Input } from '@/components/ui/input'
import { searchUsers } from '@/services/owner.service'
import { getDealStages } from '@/services/deal.service'
import { FilterTrigger } from '@/components/shared/FilterTrigger'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

export type DealFilters = {
  search: string
  stage: { id: string; name: string } | null
  owner: { id: string; name: string } | null
  closeDateFrom: string
  closeDateTo: string
}

export const emptyDealFilters: DealFilters = {
  search: '',
  stage: null,
  owner: null,
  closeDateFrom: '',
  closeDateTo: '',
}

type DealFilterBarProps = {
  filters: DealFilters
  onFiltersChange: (filters: DealFilters) => void
  /** Rendered at the far right of the toolbar row — e.g. the result count. */
  trailing?: React.ReactNode
}

function StageFilter({
  filters,
  onFiltersChange,
}: {
  filters: DealFilters
  onFiltersChange: (filters: DealFilters) => void
}): React.JSX.Element {
  const { data: stages = [] } = useQuery({
    queryKey: ['dealStages'],
    queryFn: getDealStages,
  })

  return (
    <FilterTrigger label="Stage" value={filters.stage?.name} active={filters.stage !== null}>
      <div className="flex flex-col gap-0.5">
        {stages.length === 0 ? (
          <p className="px-1 py-2 text-xs text-[#a0a0aa]">No stages found.</p>
        ) : (
          stages.map((stage) => (
            <button
              key={stage.id}
              type="button"
              onClick={() =>
                onFiltersChange({ ...filters, stage: { id: stage.id, name: stage.name } })
              }
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
                filters.stage?.id === stage.id ? 'font-medium text-[#1b1b1f]' : 'text-[#4b4b55]',
              )}
            >
              <span
                className="block h-2 w-2 shrink-0 rounded-full"
                style={{ background: stage.color }}
              />
              <span className="truncate">{stage.name}</span>
            </button>
          ))
        )}
        {filters.stage ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, stage: null })}
            className="mt-1 self-start text-[11.5px] text-[#8c8c96] hover:text-[#1b1b1f]"
          >
            Clear stage
          </button>
        ) : null}
      </div>
    </FilterTrigger>
  )
}

function OwnerFilter({
  filters,
  onFiltersChange,
}: {
  filters: DealFilters
  onFiltersChange: (filters: DealFilters) => void
}): React.JSX.Element {
  const [term, setTerm] = useState('')
  const debouncedTerm = useDebounce(term, 300)

  const { data: users = [] } = useQuery({
    queryKey: ['deal-owner-options', debouncedTerm],
    queryFn: () => searchUsers(debouncedTerm),
  })

  return (
    <FilterTrigger label="Owner" value={filters.owner?.name} active={filters.owner !== null}>
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
                  onClick={() => onFiltersChange({ ...filters, owner: { id: user.id, name } })}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
                    filters.owner?.id === user.id ? 'text-[#1b1b1f]' : 'text-[#4b4b55]',
                  )}
                >
                  <span className="truncate">{name || user.email}</span>
                </button>
              )
            })
          )}
        </div>
        {filters.owner ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, owner: null })}
            className="self-start text-[11.5px] text-[#8c8c96] hover:text-[#1b1b1f]"
          >
            Clear owner
          </button>
        ) : null}
      </div>
    </FilterTrigger>
  )
}

export function DealFilterBar({
  filters,
  onFiltersChange,
  trailing,
}: DealFilterBarProps): React.JSX.Element {
  const hasActiveFilters =
    filters.stage !== null ||
    filters.owner !== null ||
    filters.closeDateFrom !== '' ||
    filters.closeDateTo !== ''

  const closeDateLabel =
    filters.closeDateFrom && filters.closeDateTo
      ? `${filters.closeDateFrom} → ${filters.closeDateTo}`
      : filters.closeDateFrom || filters.closeDateTo

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[#f2f2f5] px-[18px] py-3.5">
      <div className="flex h-[34px] w-[280px] max-w-full items-center gap-[9px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-[11px] transition-colors focus-within:border-[#c7c7d1] focus-within:bg-white">
        <span className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[#a0a0aa]" />
        <input
          type="text"
          aria-label="Search deals"
          placeholder="Search deals"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#1b1b1f] outline-none placeholder:text-[#9b9ba3]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StageFilter filters={filters} onFiltersChange={onFiltersChange} />
        <OwnerFilter filters={filters} onFiltersChange={onFiltersChange} />

        <FilterTrigger
          label="Close date"
          value={closeDateLabel}
          active={filters.closeDateFrom !== '' || filters.closeDateTo !== ''}
        >
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[11.5px] text-[#8c8c96]">
              From
              <Input
                className="h-8 text-xs"
                type="date"
                value={filters.closeDateFrom}
                onChange={(e) => onFiltersChange({ ...filters, closeDateFrom: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] text-[#8c8c96]">
              To
              <Input
                className="h-8 text-xs"
                type="date"
                value={filters.closeDateTo}
                onChange={(e) => onFiltersChange({ ...filters, closeDateTo: e.target.value })}
              />
            </label>
          </div>
        </FilterTrigger>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...emptyDealFilters, search: filters.search })}
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
