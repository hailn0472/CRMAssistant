'use client'

import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  shareDashboard,
  unshareDashboard,
  fetchDashboardShares,
} from '@/services/dashboard.service'
import type { DashboardShare } from '@/services/dashboard.service'
import { getUsers } from '@/services/user.service'
import { getTeams } from '@/services/team.service'

interface ShareDashboardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dashboardId: string
}

type ShareFormState = {
  shareWithType: 'user' | 'team'
  shareWithId: string
}

const initialFormState: ShareFormState = {
  shareWithType: 'user',
  shareWithId: '',
}

type UserOption = { id: string; firstName: string; lastName: string; email: string }
type TeamOption = { id: string; name: string }

function resolveShareLabel(
  share: DashboardShare,
  users: UserOption[],
  teams: TeamOption[],
): string {
  if (share.sharedWithUserId) {
    const u = users.find((x) => x.id === share.sharedWithUserId)
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.email : share.sharedWithUserId
  }
  if (share.sharedWithTeamId) {
    const t = teams.find((x) => x.id === share.sharedWithTeamId)
    return t ? t.name : share.sharedWithTeamId
  }
  return 'Unknown'
}

/**
 * ShareDashboardDialog — Share a dashboard with users or teams.
 *
 * Reuses ShareDialog patterns (user/team picker, existing-share list, revoke)
 * but uses dashboard-specific mutations (AC 81).
 */
export function ShareDashboardDialog({
  open,
  onOpenChange,
  dashboardId,
}: ShareDashboardDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ShareFormState>(initialFormState)

  const { data: users = [] } = useQuery({
    queryKey: ['users', { pageSize: 200 }],
    queryFn: async () => {
      const res = await getUsers(1, 200)
      return res.items as UserOption[]
    },
    enabled: open,
  })

  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: () => getTeams() as Promise<TeamOption[]>,
    enabled: open,
  })

  const { data: shares = [] } = useQuery({
    queryKey: ['dashboardShares', dashboardId],
    queryFn: () => fetchDashboardShares(dashboardId),
    enabled: open,
  })

  const shareMutation = useMutation({
    mutationFn: async () => {
      if (!form.shareWithId) return
      await shareDashboard(
        dashboardId,
        form.shareWithType === 'user' ? form.shareWithId : undefined,
        form.shareWithType === 'team' ? form.shareWithId : undefined,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
      queryClient.invalidateQueries({ queryKey: ['dashboardShares', dashboardId] })
      toast.success('Dashboard shared successfully')
      setForm(initialFormState)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to share dashboard')
    },
  })

  const unshareMutation = useMutation({
    mutationFn: (shareId: string) => unshareDashboard(shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboardShares', dashboardId] })
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
      toast.success('Access revoked')
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to revoke access')
    },
  })

  const handleCancel = (): void => {
    onOpenChange(false)
    setForm(initialFormState)
  }

  const handleShare = (): void => {
    shareMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Share Dashboard</DialogTitle>
          <button
            type="button"
            onClick={handleCancel}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <p className="mb-4 text-sm text-slate-500">
          Share this dashboard with users or teams. They will have read-only access.
        </p>

        <div className="space-y-4">
          {/* Existing shares */}
          {shares.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Shared with
              </h4>
              <ul className="space-y-1">
                {shares.map((share) => (
                  <li
                    key={share.id}
                    className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                  >
                    <span className="truncate text-slate-700">
                      {resolveShareLabel(share, users, teams)}
                    </span>
                    <button
                      type="button"
                      onClick={() => unshareMutation.mutate(share.id)}
                      disabled={unshareMutation.isPending}
                      className="ml-2 shrink-0 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      aria-label={`Revoke access for ${resolveShareLabel(share, users, teams)}`}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Share target type */}
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="shareType"
                value="user"
                checked={form.shareWithType === 'user'}
                onChange={() => setForm({ shareWithType: 'user', shareWithId: '' })}
              />
              User
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="shareType"
                value="team"
                checked={form.shareWithType === 'team'}
                onChange={() => setForm({ shareWithType: 'team', shareWithId: '' })}
              />
              Team
            </label>
          </div>

          {/* Share target selector */}
          <div>
            <label htmlFor="shareWith" className="mb-1 block text-sm font-medium text-slate-700">
              {form.shareWithType === 'user' ? 'Select user' : 'Select team'}
            </label>
            <select
              id="shareWith"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              value={form.shareWithId}
              onChange={(e) => setForm({ ...form, shareWithId: e.target.value })}
              disabled={shareMutation.isPending}
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

          {/* Access level (read-only for dashboards) */}
          <div>
            <label htmlFor="accessLevel" className="mb-1 block text-sm font-medium text-slate-700">
              Access level
            </label>
            <select
              id="accessLevel"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm bg-slate-100 text-slate-500"
              value="READ"
              disabled
            >
              <option value="READ">Read only</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Dashboards can only be shared with read-only access.
            </p>
          </div>

          {shareMutation.isError && (
            <p className="text-xs text-red-600">
              {shareMutation.error instanceof Error
                ? shareMutation.error.message
                : 'Failed to share dashboard'}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancel}
            disabled={shareMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleShare}
            disabled={!form.shareWithId || shareMutation.isPending}
          >
            {shareMutation.isPending ? 'Sharing...' : 'Share'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
