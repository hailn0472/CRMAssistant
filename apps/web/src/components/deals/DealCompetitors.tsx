'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { getDealCompetitors, removeCompetitorFromDeal } from '@/services/competitor.service'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
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
    <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[#f2f2f5] px-[18px] py-[14px]">
        <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Competitors</h2>
        <button
          type="button"
          className="h-[30px] rounded-[8px] border border-[#e6e6eb] bg-white px-[11px] text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          onClick={() => setDialogOpen(true)}
        >
          + Add competitor
        </button>
      </div>

      {error ? (
        <ErrorState message="Failed to load competitors" />
      ) : !links || links.length === 0 ? (
        <div className="flex items-center gap-[12px] p-[18px]">
          <span className="block h-[30px] w-[30px] flex-none rounded-[8px] border border-dashed border-[#d8d8e0]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[#1b1b1f]">No competitors recorded</span>
            <span className="text-[12px] text-[#8c8c96]">
              Needed for this deal to appear in win/loss analysis.
            </span>
          </div>
        </div>
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <caption className="sr-only">Competitors on this deal</caption>
            <thead>
              <tr className="border-b border-[#f2f2f5] bg-[#fafafb] text-left text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
                <th scope="col" className="px-[18px] py-2.5">
                  Competitor
                </th>
                <th scope="col" className="px-4 py-2.5">
                  Note
                </th>
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr
                  key={link.id}
                  className="border-b border-[#f4f4f7] transition-colors last:border-0 hover:bg-[#fafafb]"
                >
                  <td className="px-[18px] py-3 text-[13px] font-medium text-[#1b1b1f]">
                    {link.competitor.name}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#8c8c96]">{link.note ?? '—'}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleRemove(link.id)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[#a0a0aa] transition-colors hover:bg-[#f4f4f6] hover:text-[#b91c1c]"
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
    </section>
  )
}
