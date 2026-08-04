'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { getCompetitors, updateCompetitor, deleteCompetitor } from '@/services/competitor.service'
import { useMyPermissions } from '@/hooks/usePermission'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { Button } from '@/components/ui/button'
import { CompetitorForm } from './CompetitorForm'
import type { Competitor } from '@/services/competitor.service'

export function CompetitorsManager(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null)

  const { hasPermission, isLoading: permissionsLoading } = useMyPermissions()
  const canRead = hasPermission('COMPETITOR', 'READ')
  const canCreate = hasPermission('COMPETITOR', 'CREATE')
  const canUpdate = hasPermission('COMPETITOR', 'UPDATE')
  const canDelete = hasPermission('COMPETITOR', 'DELETE')

  const { data, isLoading, error } = useQuery({
    queryKey: ['competitors'],
    queryFn: () => getCompetitors(1, 100, { includeInactive: true }),
    enabled: canRead,
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateCompetitor(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] })
      toast.success('Competitor status updated')
    },
    onError: () => {
      toast.error('Failed to update competitor')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCompetitor(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] })
      toast.success('Competitor deleted')
    },
    onError: () => {
      toast.error('Failed to delete competitor')
    },
  })

  if (permissionsLoading) return <TableSkeleton />

  if (!canRead) {
    return <PermissionLimitedState message="You do not have permission to view competitors." />
  }

  if (isLoading) return <TableSkeleton />

  if (error) return <ErrorState message="Failed to load competitors" />

  const handleEdit = (competitor: Competitor): void => {
    setEditingCompetitor(competitor)
    setFormOpen(true)
  }

  const handleCreate = (): void => {
    setEditingCompetitor(null)
    setFormOpen(true)
  }

  const handleDelete = (competitor: Competitor): void => {
    if (!confirm(`Delete competitor "${competitor.name}"?`)) return
    deleteMutation.mutate(competitor.id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Competitors</h2>
        {canCreate && (
          <Button variant="default" size="sm" className="gap-1.5" onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5" />
            Add competitor
          </Button>
        )}
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          title="No competitors yet"
          description="Add competitors to start tracking win/loss outcomes."
        />
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <caption className="sr-only">Competitors</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-4 py-3">
                  Name
                </th>
                <th scope="col" className="px-4 py-3">
                  Website
                </th>
                <th scope="col" className="px-4 py-3">
                  Strengths
                </th>
                <th scope="col" className="px-4 py-3">
                  Weaknesses
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((competitor) => (
                <tr key={competitor.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{competitor.name}</td>
                  <td className="px-4 py-3 text-slate-500">{competitor.website ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{competitor.strengths ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{competitor.weaknesses ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={competitor.isActive ? 'text-green-600' : 'text-slate-400'}>
                      {competitor.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {canUpdate && (
                        <button
                          type="button"
                          onClick={() => handleEdit(competitor)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                          aria-label="Edit competitor"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {canUpdate && (
                        <button
                          type="button"
                          onClick={() =>
                            toggleActiveMutation.mutate({
                              id: competitor.id,
                              isActive: !competitor.isActive,
                            })
                          }
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                          aria-label={
                            competitor.isActive ? 'Deactivate competitor' : 'Activate competitor'
                          }
                        >
                          {competitor.isActive ? '✕' : '✓'}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(competitor)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                          aria-label="Delete competitor"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      <CompetitorForm
        competitor={editingCompetitor}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingCompetitor(null)
        }}
      />
    </div>
  )
}
