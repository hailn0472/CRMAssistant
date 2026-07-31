'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { getDealCompetitors, removeCompetitorFromDeal } from '@/services/competitor.service'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { Button } from '@/components/ui/button'
import { CompetitorDialog } from './CompetitorDialog'

type DealCompetitorsProps = {
  dealId: string
}

export function DealCompetitors({ dealId }: DealCompetitorsProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)

  const {
    data: links,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['dealCompetitors', dealId],
    queryFn: () => getDealCompetitors(dealId),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeCompetitorFromDeal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealCompetitors', dealId] })
      router.refresh()
      toast.success('Competitor removed')
    },
    onError: () => {
      toast.error('Failed to remove competitor')
    },
  })

  const handleRemove = (id: string): void => {
    if (!confirm('Remove this competitor from the deal?')) return
    removeMutation.mutate(id)
  }

  if (isLoading) return <TableSkeleton />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Competitors
        </h3>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add competitor
        </Button>
      </div>

      {error ? (
        <ErrorState message="Failed to load competitors" />
      ) : !links || links.length === 0 ? (
        <EmptyState
          title="No competitors on this deal yet"
          description="Add competitors you are tracking against to analyze win/loss outcomes."
        />
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <caption className="sr-only">Competitors on this deal</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-4 py-3">
                  Competitor
                </th>
                <th scope="col" className="px-4 py-3">
                  Note
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{link.competitor.name}</td>
                  <td className="px-4 py-3 text-slate-500">{link.note ?? '—'}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleRemove(link.id)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                      aria-label={`Remove ${link.competitor.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      <CompetitorDialog dealId={dealId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
