'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getSharingRules,
  shareRecord,
  unshareRecord,
  updateSharingAccess,
} from '@/services/sharing.service'
import { getUsers } from '@/services/user.service'
import { getTeams } from '@/services/team.service'
import type { SharingRule } from '@/services/sharing.service'

type ShareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceType: 'CONTACT' | 'TASK'
  resourceId: string
}

type ShareFormState = {
  shareWithType: 'user' | 'team'
  shareWithId: string
  accessLevel: 'READ' | 'EDIT' | 'FULL'
}

const initialFormState: ShareFormState = {
  shareWithType: 'user',
  shareWithId: '',
  accessLevel: 'READ',
}

export function ShareDialog({
  open,
  onOpenChange,
  resourceType,
  resourceId,
}: ShareDialogProps): React.ReactElement {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ShareFormState>(initialFormState)

  const [unshareError, setUnshareError] = useState<string | null>(null)
  const [updateAccessError, setUpdateAccessError] = useState<string | null>(null)

  const { data: sharingRules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['sharingRules', resourceType, resourceId],
    queryFn: () => getSharingRules(resourceType, resourceId),
    enabled: open,
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users', { pageSize: 200 }],
    queryFn: async () => {
      const res = await getUsers(1, 200)
      return res.items
    },
    enabled: open,
  })

  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: () => getTeams(),
    enabled: open,
  })

  const shareMutation = useMutation({
    mutationFn: shareRecord,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sharingRules', resourceType, resourceId] })
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setForm(initialFormState)
    },
  })

  const unshareMutation = useMutation({
    mutationFn: unshareRecord,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sharingRules', resourceType, resourceId] })
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setUnshareError(null)
    },
    onError: (error: unknown) => {
      setUnshareError(error instanceof Error ? error.message : 'Failed to revoke sharing')
    },
  })

  const updateAccessMutation = useMutation({
    mutationFn: ({ id, accessLevel }: { id: string; accessLevel: string }) =>
      updateSharingAccess(id, accessLevel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sharingRules', resourceType, resourceId] })
      setUpdateAccessError(null)
    },
    onError: (error: unknown) => {
      setUpdateAccessError(
        error instanceof Error ? error.message : 'Failed to update sharing access',
      )
    },
  })

  async function handleShare(): Promise<void> {
    if (!form.shareWithId) return
    await shareMutation.mutateAsync({
      resourceType,
      resourceId,
      ...(form.shareWithType === 'user'
        ? { sharedWithUserId: form.shareWithId }
        : { sharedWithTeamId: form.shareWithId }),
      accessLevel: form.accessLevel,
    })
  }

  function getUserName(rule: SharingRule): string {
    if (!rule.sharedWithUserId) return ''
    const user = users.find((u) => u.id === rule.sharedWithUserId)
    return user ? `${user.firstName} ${user.lastName}` : rule.sharedWithUserId
  }

  function getTeamName(rule: SharingRule): string {
    if (!rule.sharedWithTeamId) return ''
    const team = teams.find((t) => t.id === rule.sharedWithTeamId)
    return team?.name ?? rule.sharedWithTeamId
  }

  function getShareTargetName(rule: SharingRule): string {
    if (rule.sharedWithUserId) return `User: ${getUserName(rule)}`
    if (rule.sharedWithTeamId) return `Team: ${getTeamName(rule)}`
    return 'Unknown'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share this {resourceType.toLowerCase()}</DialogTitle>
        </DialogHeader>

        {/* Share form */}
        <div className="space-y-4 border-b border-slate-200 pb-4">
          <div className="flex gap-2">
            <label className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                name="shareType"
                value="user"
                checked={form.shareWithType === 'user'}
                onChange={() => setForm({ ...form, shareWithType: 'user', shareWithId: '' })}
              />
              User
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                name="shareType"
                value="team"
                checked={form.shareWithType === 'team'}
                onChange={() => setForm({ ...form, shareWithType: 'team', shareWithId: '' })}
              />
              Team
            </label>
          </div>

          <div>
            <label htmlFor="shareWith" className="mb-1 block text-sm font-medium text-slate-700">
              {form.shareWithType === 'user' ? 'User' : 'Team'}
            </label>
            <select
              id="shareWith"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              value={form.shareWithId}
              onChange={(e) => setForm({ ...form, shareWithId: e.target.value })}
            >
              <option value="">Select {form.shareWithType === 'user' ? 'a user' : 'a team'}</option>
              {form.shareWithType === 'user'
                ? users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} ({u.email})
                    </option>
                  ))
                : teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
            </select>
          </div>

          <div>
            <label htmlFor="accessLevel" className="mb-1 block text-sm font-medium text-slate-700">
              Access level
            </label>
            <select
              id="accessLevel"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              value={form.accessLevel}
              onChange={(e) =>
                setForm({ ...form, accessLevel: e.target.value as 'READ' | 'EDIT' | 'FULL' })
              }
            >
              <option value="READ">Read</option>
              <option value="EDIT">Edit</option>
              <option value="FULL">Full</option>
            </select>
          </div>

          <Button
            onClick={handleShare}
            disabled={!form.shareWithId || shareMutation.isPending}
            className="bg-slate-950 text-white hover:bg-slate-800"
          >
            {shareMutation.isPending ? 'Sharing...' : 'Share'}
          </Button>
          {shareMutation.isError && (
            <p className="text-xs text-red-600">
              {shareMutation.error instanceof Error
                ? shareMutation.error.message
                : 'Failed to share record'}
            </p>
          )}
        </div>

        {/* Existing sharing rules */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-700">Existing sharing rules</h4>
          {unshareError && <p className="mb-2 text-xs text-red-600">{unshareError}</p>}
          {updateAccessError && <p className="mb-2 text-xs text-red-600">{updateAccessError}</p>}
          {rulesLoading && <p className="text-sm text-slate-500">Loading...</p>}
          {!rulesLoading && sharingRules.length === 0 && (
            <p className="text-sm text-slate-500">No sharing rules yet.</p>
          )}
          {sharingRules.length > 0 && (
            <ul className="space-y-2">
              {sharingRules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
                >
                  <div className="text-sm">
                    <span className="font-medium">{getShareTargetName(rule)}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      Access:{' '}
                      <select
                        className="border-b border-slate-300 text-xs"
                        value={rule.accessLevel}
                        onChange={(e) =>
                          updateAccessMutation.mutate({
                            id: rule.id,
                            accessLevel: e.target.value,
                          })
                        }
                      >
                        <option value="READ">Read</option>
                        <option value="EDIT">Edit</option>
                        <option value="FULL">Full</option>
                      </select>
                    </span>
                  </div>
                  <button
                    onClick={() => unshareMutation.mutate(rule.id)}
                    className="text-xs text-red-600 hover:text-red-800"
                    type="button"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
