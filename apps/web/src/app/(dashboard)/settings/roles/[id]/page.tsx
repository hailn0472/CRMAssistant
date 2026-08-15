'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { getRole, getRoleUsers } from '@/services/role.service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function RoleDetailContent(): React.JSX.Element {
  const params = useParams()
  const id = String(params.id)
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['role', id],
    queryFn: () => getRole(id),
  })

  const { data: users } = useQuery({
    queryKey: ['roleUsers', id],
    queryFn: () => getRoleUsers(id),
  })

  if (isLoading) {
    return <TableSkeleton rows={3} columns={2} />
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to load role.'
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />
  }

  if (!data) {
    return <ErrorState message="Role not found" />
  }

  return (
    <>
      <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-100">
          <CardTitle className="text-lg">Role details</CardTitle>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/settings/roles/${data.id}/permissions`}>Permissions</Link>
            </Button>
            {!data.isSystem && (
              <Button asChild variant="outline">
                <Link href={`/settings/roles/${data.id}/edit`}>Edit</Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Name
              </p>
              <p className="mt-2 text-sm font-medium text-slate-950">{data.name}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Type
              </p>
              <p className="mt-2 text-sm font-medium text-slate-950">
                {data.isSystem ? 'System' : 'Custom'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Description
              </p>
              <p className="mt-2 text-sm font-medium text-slate-950">
                {data.description ?? 'No description'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Users
              </p>
              <p className="mt-2 text-sm font-medium text-slate-950">{data.userCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Created
              </p>
              <p className="mt-2 text-sm font-medium text-slate-950">
                {new Date(data.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {users && users.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-700">Assigned Users</p>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 pl-4 pr-4 font-medium">Name</th>
                <th className="py-3 pr-4 font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr className="hover:bg-slate-50" key={u.id}>
                  <td className="py-3 pl-4 pr-4 font-medium">
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{u.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default function RoleDetailPage(): React.JSX.Element {
  return (
    <main className="space-y-6 p-6 text-slate-950">
      <QueryProvider>
        <RoleDetailContent />
      </QueryProvider>
    </main>
  )
}
