'use client'

import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PermissionData {
  id: string
  resource: string
  action: string
  description?: string | null
}

interface PermissionMatrixProps {
  allPermissions: PermissionData[]
  assignedPermissionIds: Set<string>
  onSave: (selectedIds: string[]) => Promise<void>
  disabled?: boolean
  userCount?: number
  isLoading?: boolean
}

const RESOURCE_LABELS: Record<string, string> = {
  CONTACT: 'Contacts',
  TASK: 'Tasks',
  TICKET: 'Tickets',
  REPORT: 'Reports',
  USER: 'Users',
  ROLE: 'Roles',
  SETTINGS: 'Settings',
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Create',
  READ: 'Read',
  UPDATE: 'Update',
  DELETE: 'Delete',
  EXPORT: 'Export',
  IMPORT: 'Import',
  ASSIGN: 'Assign',
}

const ACTION_ORDER = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT', 'ASSIGN']
const RESOURCE_ORDER = ['CONTACT', 'TASK', 'TICKET', 'REPORT', 'USER', 'ROLE', 'SETTINGS']

function groupByResource(permissions: PermissionData[]): Map<string, PermissionData[]> {
  const map = new Map<string, PermissionData[]>()
  for (const perm of permissions) {
    const group = map.get(perm.resource) ?? []
    group.push(perm)
    map.set(perm.resource, group)
  }
  return map
}

export function PermissionMatrix({
  allPermissions,
  assignedPermissionIds,
  onSave,
  disabled = false,
  userCount = 0,
  isLoading: isLoadingProp,
}: PermissionMatrixProps): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(assignedPermissionIds))
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const byResource = groupByResource(allPermissions)

  const isDirty =
    selectedIds.size !== assignedPermissionIds.size ||
    ![...selectedIds].every((id) => assignedPermissionIds.has(id))

  const togglePermission = useCallback(
    (permissionId: string, action: string) => {
      // Require confirmation for DELETE action
      if (action === 'DELETE' && !selectedIds.has(permissionId)) {
        setPendingDelete(permissionId)
        return
      }

      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(permissionId)) {
          next.delete(permissionId)
        } else {
          next.add(permissionId)
        }
        return next
      })
    },
    [selectedIds],
  )

  const confirmDeletePermission = useCallback(() => {
    if (pendingDelete) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.add(pendingDelete)
        return next
      })
      setPendingDelete(null)
    }
  }, [pendingDelete])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave([...selectedIds])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }, [selectedIds, onSave])

  const isLoading = isLoadingProp ?? allPermissions.length === 0

  return (
    <div className="space-y-4">
      {/* Delete confirmation dialog */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-slate-950/30"
            onClick={() => setPendingDelete(null)}
          />
          <div className="relative z-10 rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <p className="text-sm font-semibold text-slate-950">Confirm delete access</p>
            <p className="mt-2 text-sm text-slate-600">
              This grants delete access.{' '}
              {userCount > 0 ? `${userCount} users will be affected.` : ''}
            </p>
            <div className="mt-4 flex gap-3">
              <Button variant="outline" size="sm" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmDeletePermission}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Grant delete access
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="animate-pulse space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="h-9 w-24 rounded bg-slate-100" />
              {[...Array(7)].map((_, j) => (
                <div key={j} className="h-9 w-12 rounded bg-slate-100" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">{error}</p>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-red-600 underline hover:text-red-800"
            onClick={handleSave}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && allPermissions.length === 0 && (
        <div className="rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-600">No permissions available.</p>
        </div>
      )}

      {/* Permission matrix table */}
      {!isLoading && allPermissions.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="sticky left-0 z-10 bg-slate-50 py-3 pl-4 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Resource
                  </th>
                  {ACTION_ORDER.map((action) => (
                    <th
                      key={action}
                      className="py-3 pr-4 text-center text-xs font-semibold uppercase tracking-wider text-slate-600"
                    >
                      {ACTION_LABELS[action] ?? action}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {RESOURCE_ORDER.map((resource) => {
                  const perms = byResource.get(resource) ?? []
                  const actionMap = new Map(perms.map((p) => [p.action, p]))
                  return (
                    <tr key={resource} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white py-3 pl-4 pr-4 font-medium text-slate-950">
                        {RESOURCE_LABELS[resource] ?? resource}
                      </td>
                      {ACTION_ORDER.map((action) => {
                        const perm = actionMap.get(action)
                        if (!perm) {
                          return <td key={action} className="py-3 pr-4 text-center" />
                        }
                        const isChecked = selectedIds.has(perm.id)
                        return (
                          <td key={action} className="py-3 pr-4 text-center">
                            <input
                              type="checkbox"
                              className={cn(
                                'h-4 w-4 rounded border-slate-300',
                                'focus:ring-2 focus:ring-blue-600 focus:ring-offset-0',
                                (disabled || saving) && 'cursor-not-allowed opacity-50',
                              )}
                              checked={isChecked}
                              disabled={disabled || saving}
                              onChange={() => togglePermission(perm.id, action)}
                              aria-label={`${ACTION_LABELS[action] ?? action} ${RESOURCE_LABELS[resource] ?? resource}`}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Save button */}
          <div className="flex items-center justify-end gap-3">
            {userCount > 0 && isDirty && (
              <p className="text-xs text-amber-600">
                {userCount} user{userCount !== 1 ? 's' : ''} will be affected
              </p>
            )}
            <Button
              onClick={handleSave}
              disabled={!isDirty || saving || disabled}
              className={cn(
                'text-white',
                isDirty && !saving ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-400',
              )}
            >
              {saving ? 'Saving...' : 'Save permissions'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function PermissionMatrixSkeleton(): React.JSX.Element {
  return (
    <div className="animate-pulse space-y-3">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-9 w-24 rounded bg-slate-100" />
          {[...Array(7)].map((_, j) => (
            <div key={j} className="h-9 w-12 rounded bg-slate-100" />
          ))}
        </div>
      ))}
    </div>
  )
}
