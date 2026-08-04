'use client'

import { useQuery } from '@tanstack/react-query'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getRoles } from '@/services/role.service'
import { getTeams } from '@/services/team.service'
import { cn } from '@/lib/utils'

export type UserStatusFilter = '' | 'active' | 'deactivated'

export type UserFilters = {
  search: string
  role: { id: string; name: string } | null
  status: UserStatusFilter
  team: { id: string; name: string } | null
}

export const emptyUserFilters: UserFilters = {
  search: '',
  role: null,
  status: '',
  team: null,
}

type UserFilterBarProps = {
  filters: UserFilters
  onFiltersChange: (filters: UserFilters) => void
  /** Rendered at the far right of the toolbar row — e.g. the result count. */
  trailing?: React.ReactNode
}

const STATUS_LABELS: Record<Exclude<UserStatusFilter, ''>, string> = {
  active: 'Active',
  deactivated: 'Deactivated',
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

function RoleFilter({
  filters,
  onFiltersChange,
}: {
  filters: UserFilters
  onFiltersChange: (filters: UserFilters) => void
}): React.JSX.Element {
  const { data: roles = [] } = useQuery({
    queryKey: ['userRoleOptions'],
    queryFn: getRoles,
  })

  return (
    <FilterTrigger label="Role" value={filters.role?.name} active={filters.role !== null}>
      <div className="flex flex-col gap-0.5">
        {roles.length === 0 ? (
          <p className="px-1 py-2 text-xs text-[#a0a0aa]">No roles found.</p>
        ) : (
          roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() =>
                onFiltersChange({ ...filters, role: { id: role.id, name: role.name } })
              }
              className={cn(
                'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
                filters.role?.id === role.id ? 'font-medium text-[#1b1b1f]' : 'text-[#4b4b55]',
              )}
            >
              <span className="truncate">{role.name}</span>
            </button>
          ))
        )}
        {filters.role ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, role: null })}
            className="mt-1 self-start text-[11.5px] text-[#8c8c96] hover:text-[#1b1b1f]"
          >
            Clear role
          </button>
        ) : null}
      </div>
    </FilterTrigger>
  )
}

function TeamFilter({
  filters,
  onFiltersChange,
}: {
  filters: UserFilters
  onFiltersChange: (filters: UserFilters) => void
}): React.JSX.Element {
  const { data: teams = [] } = useQuery({
    queryKey: ['userTeamOptions'],
    queryFn: getTeams,
  })

  return (
    <FilterTrigger label="Team" value={filters.team?.name} active={filters.team !== null}>
      <div className="flex flex-col gap-0.5">
        {teams.length === 0 ? (
          <p className="px-1 py-2 text-xs text-[#a0a0aa]">No teams found.</p>
        ) : (
          teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() =>
                onFiltersChange({ ...filters, team: { id: team.id, name: team.name } })
              }
              className={cn(
                'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
                filters.team?.id === team.id ? 'font-medium text-[#1b1b1f]' : 'text-[#4b4b55]',
              )}
            >
              <span className="truncate">{team.name}</span>
            </button>
          ))
        )}
        {filters.team ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, team: null })}
            className="mt-1 self-start text-[11.5px] text-[#8c8c96] hover:text-[#1b1b1f]"
          >
            Clear team
          </button>
        ) : null}
      </div>
    </FilterTrigger>
  )
}

function StatusFilter({
  filters,
  onFiltersChange,
}: {
  filters: UserFilters
  onFiltersChange: (filters: UserFilters) => void
}): React.JSX.Element {
  return (
    <FilterTrigger
      label="Status"
      value={filters.status ? STATUS_LABELS[filters.status] : undefined}
      active={filters.status !== ''}
    >
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => onFiltersChange({ ...filters, status: '' })}
          className={cn(
            'rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
            filters.status === '' ? 'font-medium text-[#1b1b1f]' : 'text-[#4b4b55]',
          )}
        >
          All
        </button>
        {(Object.keys(STATUS_LABELS) as Array<Exclude<UserStatusFilter, ''>>).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onFiltersChange({ ...filters, status })}
            className={cn(
              'rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6]',
              filters.status === status ? 'font-medium text-[#1b1b1f]' : 'text-[#4b4b55]',
            )}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
    </FilterTrigger>
  )
}

export function UserFilterBar({
  filters,
  onFiltersChange,
  trailing,
}: UserFilterBarProps): React.JSX.Element {
  const hasActiveFilters = filters.role !== null || filters.status !== '' || filters.team !== null

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[#f2f2f5] px-[18px] py-3.5">
      <div className="flex h-[34px] w-[250px] max-w-full items-center gap-[9px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-[11px] transition-colors focus-within:border-[#c7c7d1] focus-within:bg-white">
        <span className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[#a0a0aa]" />
        <input
          type="text"
          aria-label="Search users"
          placeholder="Search users"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#1b1b1f] outline-none placeholder:text-[#9b9ba3]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <RoleFilter filters={filters} onFiltersChange={onFiltersChange} />
        <StatusFilter filters={filters} onFiltersChange={onFiltersChange} />
        <TeamFilter filters={filters} onFiltersChange={onFiltersChange} />

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...emptyUserFilters, search: filters.search })}
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
