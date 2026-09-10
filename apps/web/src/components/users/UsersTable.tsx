'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { getUsers, deactivateUsers, reactivateUsers } from '@/services/user.service'
import { UserFilterBar, emptyUserFilters, type UserFilters } from '@/components/users/UserFilterBar'

const PAGE_SIZE = 10

const STATUS_COLOR: Record<'active' | 'deactivated', string> = {
  active: '#22a06b',
  deactivated: '#b91c1c',
}

function userInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

function formatLastLogin(lastLoginAt?: string | null): string {
  return lastLoginAt ? new Date(lastLoginAt).toLocaleDateString() : 'Never'
}

export function UsersTable(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<UserFilters>(emptyUserFilters)
  const queryClient = useQueryClient()

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['users', page, filters],
    queryFn: () =>
      getUsers(page, PAGE_SIZE, {
        search: filters.search || undefined,
        isActive: filters.status === '' ? undefined : filters.status === 'active',
        roleId: filters.role?.id || undefined,
        teamId: filters.team?.id || undefined,
      }),
  })

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (!data) return
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(data.items.map((item) => item.id)))
    }
  }, [data, selectedIds.size])

  async function handleBulkDeactivate(): Promise<void> {
    if (selectedIds.size === 0) return
    await deactivateUsers(Array.from(selectedIds))
    clearSelection()
    queryClient.invalidateQueries({ queryKey: ['users'] })
    queryClient.invalidateQueries({ queryKey: ['users-stats'] })
  }

  async function handleBulkReactivate(): Promise<void> {
    if (selectedIds.size === 0) return
    await reactivateUsers(Array.from(selectedIds))
    clearSelection()
    queryClient.invalidateQueries({ queryKey: ['users'] })
    queryClient.invalidateQueries({ queryKey: ['users-stats'] })
  }

  function handleFiltersChange(next: UserFilters): void {
    setFilters(next)
    setPage(1)
  }

  if (isLoading) {
    return <TableSkeleton rows={5} columns={5} />
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to load users.'
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />
  }

  const isFiltered =
    filters.search !== '' || filters.role !== null || filters.status !== '' || filters.team !== null

  if ((!data || data.items.length === 0) && !isFiltered) {
    return (
      <EmptyState
        title="No users yet"
        description="Invite team members to start collaborating."
        action={
          <Button asChild className="bg-[#1b1b1f] text-white hover:bg-black">
            <Link href="/users/new">Create user</Link>
          </Button>
        }
      />
    )
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const currentPage = data?.page ?? page
  const allSelected = items.length > 0 && selectedIds.size === items.length

  return (
    <Card className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white shadow-none">
      <UserFilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        trailing={<span className="text-[12.5px] font-medium text-[#8c8c96]">{total} users</span>}
      />

      {selectedIds.size > 0 ? (
        <div className="flex items-center gap-2.5 border-b border-[#f2f2f5] bg-[#fafafb] px-[18px] py-2.5">
          <span className="text-[12.5px] font-medium text-[#4b4b55]">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => void handleBulkDeactivate()}
            className="inline-flex h-8 items-center rounded-[8px] border border-[#e6e6eb] bg-white px-2.5 text-[12px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            Deactivate
          </button>
          <button
            type="button"
            onClick={() => void handleBulkReactivate()}
            className="inline-flex h-8 items-center rounded-[8px] border border-[#e6e6eb] bg-white px-2.5 text-[12px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            Reactivate
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-[12px] text-[#8c8c96] hover:text-[#1b1b1f]"
          >
            Clear
          </button>
        </div>
      ) : null}

      <ResponsiveTableWrapper>
        <table className="w-full min-w-[1050px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-[#f2f2f5] bg-[#fafafb] text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
              <th className="w-9 py-2.5 pl-[18px] pr-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-[15px] w-[15px] rounded border-[#d8d8e0] accent-[#1b1b1f]"
                />
              </th>
              <th className="py-2.5 pr-4">Name</th>
              <th className="py-2.5 pr-4">Email</th>
              <th className="py-2.5 pr-4">Role</th>
              <th className="py-2.5 pr-4">Status</th>
              <th className="py-2.5 pr-[18px]">Last login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f4f4f7]">
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-[18px] py-10 text-center text-[13px] text-[#8c8c96]">
                  No users match these filters.
                </td>
              </tr>
            ) : (
              items.map((user) => {
                const statusKey = user.isActive ? 'active' : 'deactivated'
                return (
                  <tr key={user.id} className="transition-colors hover:bg-[#fafafb]">
                    <td className="py-3 pl-[18px] pr-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${user.firstName} ${user.lastName}`}
                        checked={selectedIds.has(user.id)}
                        onChange={() => toggleSelect(user.id)}
                        className="h-[15px] w-[15px] rounded border-[#d8d8e0] accent-[#1b1b1f]"
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/users/${user.id}`}
                        className="flex min-w-0 items-center gap-2.5 transition-colors hover:text-indigo-600"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f0f0f3] text-[10.5px] font-semibold text-[#4b4b55]">
                          {userInitials(user.firstName, user.lastName)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-[#1b1b1f]">
                            {user.firstName} {user.lastName}
                          </span>
                          {user.team ? (
                            <span className="truncate text-[11.5px] text-[#a0a0aa]">
                              {user.team.name}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </td>
                    <td className="max-w-[260px] truncate py-3 pr-4 text-[13px]">
                      <a href={`mailto:${user.email}`} className="text-indigo-600 hover:underline">
                        {user.email}
                      </a>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {user.roles && user.roles.length > 0 ? (
                          user.roles.map((r) => <RoleBadge key={r.id} role={r.name} />)
                        ) : (
                          <span className="text-[12px] italic text-[#c0c0c8]">No roles</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                        style={{ color: STATUS_COLOR[statusKey] }}
                      >
                        <span
                          className="block h-1.5 w-1.5 rounded-full"
                          style={{ background: STATUS_COLOR[statusKey] }}
                        />
                        {statusKey === 'active' ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="py-3 pr-[18px] font-mono text-[12px] text-[#8c8c96]">
                      {formatLastLogin(user.lastLoginAt)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      {items.length > 0 ? (
        <div className="flex items-center justify-between gap-4 border-t border-[#f2f2f5] px-[18px] py-3.5">
          <span className="text-[12.5px] text-[#8c8c96]">
            Page {currentPage} of {totalPages} · {total} users
          </span>
          <div className="flex items-center gap-[5px]">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              className="inline-flex h-[30px] items-center rounded-[8px] border border-[#e6e6eb] bg-white px-2.5 text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:cursor-not-allowed disabled:border-[#f0f0f3] disabled:bg-[#fafafb] disabled:text-[#c0c0c8]"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
              className="inline-flex h-[30px] items-center rounded-[8px] border border-[#e6e6eb] bg-white px-2.5 text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:cursor-not-allowed disabled:border-[#f0f0f3] disabled:bg-[#fafafb] disabled:text-[#c0c0c8]"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function RoleBadge({ role }: { role: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center rounded-[6px] border border-[#ececf0] bg-[#f4f4f6] px-2 py-0.5 text-[11.5px] font-medium text-[#4b4b55]">
      {role.replace('_', ' ')}
    </span>
  )
}
