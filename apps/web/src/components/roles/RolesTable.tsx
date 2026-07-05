'use client'

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { getRoles, deleteRole } from '@/services/role.service'

export function RolesTable(): React.JSX.Element {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['roles'],
    queryFn: getRoles,
  })
  const queryClient = useQueryClient()

  if (isLoading) {
    return <TableSkeleton rows={5} columns={4} />
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to load roles.'
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No roles yet"
        description="Create custom roles to manage permissions."
        action={
          <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
            <Link href="/settings/roles/new">Create role</Link>
          </Button>
        }
      />
    )
  }

  async function handleDelete(roleId: string, roleName: string): Promise<void> {
    if (!confirm(`Delete role "${roleName}"? This cannot be undone.`)) return
    await deleteRole(roleId)
    queryClient.invalidateQueries({ queryKey: ['roles'] })
  }

  return (
    <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">All Roles</CardTitle>
        <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
          <Link href="/settings/roles/new">Create role</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <ResponsiveTableWrapper>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="py-3 pr-4 pl-4 font-medium">Name</th>
                <th className="py-3 pr-4 font-medium">Description</th>
                <th className="py-3 pr-4 font-medium">Users</th>
                <th className="py-3 pr-4 font-medium">Type</th>
                <th className="py-3 pr-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((role) => (
                <tr className="group hover:bg-slate-50" key={role.id}>
                  <td className="py-3 pr-4 pl-4 font-medium">
                    <Link
                      className="text-blue-700 hover:text-blue-800 hover:underline"
                      href={`/settings/roles/${role.id}`}
                    >
                      {role.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{role.description ?? '—'}</td>
                  <td className="py-3 pr-4 text-slate-600">{role.userCount}</td>
                  <td className="py-3 pr-4">
                    {role.isSystem ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        System
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Custom
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex gap-1">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/settings/roles/${role.id}`}>View</Link>
                      </Button>
                      {!role.isSystem && (
                        <>
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/settings/roles/${role.id}/edit`}>Edit</Link>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(role.id, role.name)}
                            className="text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      </CardContent>
    </Card>
  )
}
