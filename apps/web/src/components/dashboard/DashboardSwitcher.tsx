'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { LayoutDashboard, Plus, Trash2, Star, ChevronDown, Pencil, Share2 } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import {
  fetchDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
} from '@/services/dashboard.service'
import type { DashboardData } from '@/services/dashboard.service'

interface DashboardSwitcherProps {
  currentDashboardId?: string
  /** Opens the share dialog for the given dashboard (AC 80 — Share is a switcher action). */
  onShareDashboard?: (dashboardId: string) => void
}

/**
 * DashboardSwitcher — Popover-based dashboard selector.
 *
 * Lists owned dashboards, "Shared with me" group. New/Rename/Delete/Set default/Share actions.
 * Pushes ?dashboard=<id> on selection.
 */
export function DashboardSwitcher({
  currentDashboardId,
  onShareDashboard,
}: DashboardSwitcherProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)

  const { data: dashList } = useQuery({
    queryKey: ['dashboards'],
    queryFn: fetchDashboards,
    enabled: open,
  })

  const ownedDashboards: DashboardData[] = dashList?.owned ?? []
  const sharedDashboards: DashboardData[] = dashList?.sharedWithMe ?? []

  // New dashboard mutation
  const createMutation = useMutation({
    mutationFn: () => createDashboard({ name: 'Untitled Dashboard' }),
    onSuccess: (dash: DashboardData) => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
      toast.success('Dashboard created')
      router.push(`/dashboard?dashboard=${dash.id}`)
      setOpen(false)
    },
    onError: () => {
      toast.error('Failed to create dashboard')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDashboard(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'my'] })
      toast.success('Dashboard deleted')
    },
    onError: () => {
      toast.error('Failed to delete dashboard')
    },
  })

  // Set default mutation
  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => updateDashboard(id, { isDefault: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
      toast.success('Default dashboard updated')
    },
    onError: () => {
      toast.error('Failed to set default dashboard')
    },
  })

  // Rename mutation (AC 80)
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateDashboard(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
      toast.success('Dashboard renamed')
    },
    onError: () => {
      toast.error('Failed to rename dashboard')
    },
  })

  const handleSelect = (id: string): void => {
    router.push(`/dashboard?dashboard=${id}`)
    setOpen(false)
  }

  const currentDashboard =
    ownedDashboards.find((d) => d.id === currentDashboardId)?.name ??
    sharedDashboards.find((d) => d.id === currentDashboardId)?.name ??
    'Dashboard'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          aria-label="Switch dashboard"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span className="max-w-[120px] truncate">{currentDashboard}</span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="max-h-[320px] overflow-y-auto px-2 py-2">
          {/* Owned dashboards */}
          {ownedDashboards.length > 0 && (
            <div className="mb-2">
              {ownedDashboards.map((dash) => (
                <div
                  key={dash.id}
                  className={`group flex items-center justify-between rounded-md px-2 py-1.5 ${
                    dash.id === currentDashboardId ? 'bg-indigo-50' : 'hover:bg-slate-50'
                  }`}
                >
                  {renameId === dash.id ? (
                    <input
                      autoFocus
                      defaultValue={dash.name}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const name = (e.target as HTMLInputElement).value.trim()
                          if (name && name !== dash.name) {
                            renameMutation.mutate({ id: dash.id, name })
                          }
                          setRenameId(null)
                        } else if (e.key === 'Escape') {
                          setRenameId(null)
                        }
                      }}
                      onBlur={() => setRenameId(null)}
                      className="min-w-0 flex-1 rounded border border-indigo-300 px-1.5 py-0.5 text-xs text-slate-700"
                      aria-label={`Rename ${dash.name}`}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSelect(dash.id)}
                      className="min-w-0 flex-1 text-left text-sm"
                      aria-label={`Select dashboard ${dash.name}`}
                    >
                      <p className="truncate text-xs font-medium text-slate-700">
                        {dash.name}
                        {dash.isDefault ? (
                          <Star
                            className="ml-1 inline-block h-3 w-3 text-amber-400"
                            aria-label="Default"
                          />
                        ) : null}
                      </p>
                    </button>
                  )}
                  <div className="hidden gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenameId(dash.id)
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      aria-label={`Rename ${dash.name}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {!dash.isDefault && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDefaultMutation.mutate(dash.id)
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label={`Set ${dash.name} as default`}
                      >
                        <Star className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onShareDashboard?.(dash.id)
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      aria-label={`Share ${dash.name}`}
                    >
                      <Share2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`Delete "${dash.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(dash.id)
                        }
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${dash.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Shared with me */}
          {sharedDashboards.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Shared with me
              </div>
              {sharedDashboards.map((dash) => (
                <button
                  key={dash.id}
                  type="button"
                  onClick={() => handleSelect(dash.id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    dash.id === currentDashboardId ? 'bg-indigo-50' : 'hover:bg-slate-50'
                  }`}
                  aria-label={`Select dashboard ${dash.name}`}
                >
                  <p className="truncate text-xs text-slate-600">{dash.name}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New Dashboard button at bottom */}
        <div className="border-t border-slate-200 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            New Dashboard
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
