'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { getUsers, deactivateUsers, reactivateUsers } from '@/services/user.service'

const PAGE_SIZE = 10

export function UsersTable(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['users', page],
    queryFn: () => getUsers(page, PAGE_SIZE),
  })
  const queryClient = useQueryClient()

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
  }

  async function handleBulkReactivate(): Promise<void> {
    if (selectedIds.size === 0) return
    await reactivateUsers(Array.from(selectedIds))
    clearSelection()
    queryClient.invalidateQueries({ queryKey: ['users'] })
  }

  if (isLoading) {
    return <TableSkeleton rows={5} columns={5} />
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to load users.'
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="No users yet"
        description="Invite team members to start collaborating."
        action={
          <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
            <Link href="/users/new">Create user</Link>
          </Button>
        }
      />
    )
  }

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1)

  return (
    <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Users</CardTitle>
        <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
          <Link href="/users/new">Create user</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {selectedIds.size > 0 ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <span className="font-medium text-slate-700">{selectedIds.size} selected</span>
            <Button type="button" variant="outline" size="sm" onClick={handleBulkDeactivate}>
              Deactivate
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleBulkReactivate}>
              Reactivate
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        ) : null}

        <ResponsiveTableWrapper>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="py-3 pr-4 pl-4 font-medium">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selectedIds.size === data.items.length && data.items.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="sticky left-0 z-10 bg-slate-50 py-3 pr-4 pl-4 font-medium shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                  Name
                </th>
                <th className="py-3 pr-4 font-medium">Email</th>
                <th className="py-3 pr-4 font-medium">Role</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 pr-4 font-medium">Last login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((user) => (
                <tr className="group hover:bg-slate-50" key={user.id}>
                  <td className="py-3 pr-4 pl-4">
                    <input
                      type="checkbox"
                      aria-label={`Select ${user.firstName} ${user.lastName}`}
                      checked={selectedIds.has(user.id)}
                      onChange={() => toggleSelect(user.id)}
                    />
                  </td>
                  <td className="sticky left-0 z-10 bg-white py-3 pr-4 pl-4 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] group-hover:bg-slate-50">
                    <Link
                      className="font-medium text-blue-700 hover:text-blue-800 hover:underline"
                      href={`/users/${user.id}`}
                    >
                      {user.firstName} {user.lastName}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{user.email}</td>
                  <td className="py-3 pr-4">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge isActive={user.isActive} />
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
        <div className="mt-5 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {data.page} of {totalPages} · {data.total} users
          </span>
          <div className="flex gap-2">
            <Button
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
              type="button"
              variant="outline"
            >
              Previous
            </Button>
            <Button
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              type="button"
              variant="outline"
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function RoleBadge({ role }: { role: string }): React.JSX.Element {
  const color =
    role === 'ADMIN'
      ? 'bg-purple-100 text-purple-800'
      : role === 'MANAGER'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-slate-100 text-slate-700'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {role.replace('_', ' ')}
    </span>
  )
}

function StatusBadge({ isActive }: { isActive: boolean }): React.JSX.Element {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {isActive ? 'Active' : 'Deactivated'}
    </span>
  )
}
