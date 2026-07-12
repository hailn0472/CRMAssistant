'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { ErrorState } from '@/components/shared/ErrorState'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { PermissionMatrix, PermissionMatrixSkeleton } from '@/components/roles/PermissionMatrix'
import { getRole, getRoleUsers } from '@/services/role.service'
import {
  getAllPermissions,
  getRolePermissions,
  setRolePermissions,
} from '@/services/permission.service'
import { useAuthStore } from '@/stores/auth.store'
import { useEffect } from 'react'

function PermissionMatrixContent(): React.JSX.Element {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const id = String(params.id)

  const user = useAuthStore((s) => s.user)

  // Redirect non-ADMIN users
  useEffect(() => {
    if (user && !user.roles.includes('ADMIN')) {
      router.replace('/dashboard')
    }
  }, [user, router])

  const {
    data: role,
    isLoading: roleLoading,
    error: roleError,
    refetch: refetchRole,
  } = useQuery({
    queryKey: ['role', id],
    queryFn: () => getRole(id),
  })

  const { data: allPermissions = [], isLoading: allPermsLoading } = useQuery({
    queryKey: ['allPermissions'],
    queryFn: getAllPermissions,
  })

  const { data: assignedPermissions = [], isLoading: assignedPermsLoading } = useQuery({
    queryKey: ['rolePermissions', id],
    queryFn: () => getRolePermissions(id),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['roleUsers', id],
    queryFn: () => getRoleUsers(id),
  })

  const saveMutation = useMutation({
    mutationFn: (permissionIds: string[]) => setRolePermissions(id, permissionIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rolePermissions', id] })
      queryClient.invalidateQueries({ queryKey: ['myPermissions'] })
    },
  })

  if (roleLoading || allPermsLoading || assignedPermsLoading) {
    return <PermissionMatrixSkeleton />
  }

  if (roleError) {
    const message = roleError instanceof Error ? roleError.message : 'Unable to load role.'
    return <ErrorState message={message} onRetry={() => refetchRole()} />
  }

  if (!role) {
    return <ErrorState message="Role not found" />
  }

  const assignedIds = new Set(assignedPermissions.map((p) => p.id))

  return (
    <>
      {/* Role info header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-lg font-semibold text-slate-950">{role.name}</p>
            {role.description && <p className="text-sm text-slate-600">{role.description}</p>}
          </div>
          {role.isSystem && (
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              System
            </span>
          )}
        </div>
      </div>

      {/* Permission matrix */}
      <PermissionMatrix
        allPermissions={allPermissions}
        assignedPermissionIds={assignedIds}
        isLoading={allPermsLoading}
        onSave={async (selectedIds) => {
          await saveMutation.mutateAsync(selectedIds)
        }}
        userCount={users.length}
      />
    </>
  )
}

export default function PermissionMatrixPage(): React.JSX.Element {
  return (
    <main className="space-y-6 p-6 text-slate-950">
<QueryProvider>
        <PermissionMatrixContent />
      </QueryProvider>
    </main>
  )
}
