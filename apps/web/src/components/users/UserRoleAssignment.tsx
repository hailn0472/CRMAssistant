'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  getRoles,
} from '@/services/role.service'

type UserRoleAssignmentProps = {
  userId: string
}

export function UserRoleAssignment({ userId }: UserRoleAssignmentProps): React.JSX.Element {
  const queryClient = useQueryClient()

  const {
    data: assignedRoles,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['userRoles', userId],
    queryFn: () => getUserRoles(userId),
  })

  const { data: allRoles } = useQuery({
    queryKey: ['roles'],
    queryFn: getRoles,
  })

  const [actionError, setActionError] = useState<string | null>(null)

  const handleAssign = useCallback(
    async (roleId: string) => {
      setActionError(null)
      try {
        await assignRoleToUser(userId, roleId)
        queryClient.invalidateQueries({ queryKey: ['userRoles', userId] })
        queryClient.invalidateQueries({ queryKey: ['roles'] })
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to assign role')
      }
    },
    [userId, queryClient],
  )

  const handleRemove = useCallback(
    async (roleId: string) => {
      if (!confirm('Remove this role from the user?')) return
      setActionError(null)
      try {
        await removeRoleFromUser(userId, roleId)
        queryClient.invalidateQueries({ queryKey: ['userRoles', userId] })
        queryClient.invalidateQueries({ queryKey: ['roles'] })
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to remove role')
      }
    },
    [userId, queryClient],
  )

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading roles...</p>
  }

  if (error) {
    return <p className="text-sm text-red-600">Unable to load roles.</p>
  }

  const assignedIds = new Set(assignedRoles?.map((r) => r.id) ?? [])
  const availableRoles = allRoles?.filter((r) => !assignedIds.has(r.id)) ?? []

  return (
    <div className="space-y-4">
      {actionError && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {actionError}
        </p>
      )}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">Assigned Roles</p>
        {assignedRoles && assignedRoles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {assignedRoles.map((role) => (
              <span
                key={role.id}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
              >
                {role.name}
                <button
                  type="button"
                  onClick={() => handleRemove(role.id)}
                  className="ml-0.5 text-slate-400 hover:text-red-600"
                  aria-label={`Remove ${role.name} role`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No roles assigned</p>
        )}
      </div>

      {availableRoles.length > 0 && (
        <div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
              onChange={(e) => {
                const roleId = e.target.value
                if (roleId) {
                  handleAssign(roleId)
                  e.target.value = ''
                }
              }}
              defaultValue=""
            >
              <option value="" disabled>
                Add a role...
              </option>
              {availableRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                  {role.isSystem ? ' (System)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
