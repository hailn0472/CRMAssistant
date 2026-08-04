'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { getCompetitors, addCompetitorToDeal } from '@/services/competitor.service'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type CompetitorDialogProps = {
  dealId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CompetitorDialog({
  dealId,
  open,
  onOpenChange,
}: CompetitorDialogProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [competitorSearch, setCompetitorSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: competitorsData } = useQuery({
    queryKey: ['competitors', 'search', competitorSearch],
    queryFn: () => getCompetitors(1, 20, { search: competitorSearch || undefined }),
    enabled: showDropdown || open,
  })

  const addMutation = useMutation({
    mutationFn: (competitorId: string) => addCompetitorToDeal({ dealId, competitorId, note: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealCompetitors', dealId] })
      router.refresh()
      onOpenChange(false)
      setSelectedId(null)
      setCompetitorSearch('')
      toast.success('Competitor added to deal')
    },
  })

  const handleCompetitorSelect = (competitorId: string): void => {
    setSelectedId(competitorId)
    setShowDropdown(false)
    setCompetitorSearch('')
  }

  const handleSubmit = (): void => {
    if (!selectedId) return
    addMutation.mutate(selectedId)
  }

  const handleCancel = (): void => {
    setSelectedId(null)
    setCompetitorSearch('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent
        className="sm:max-w-md rounded-[14px] border-[#ececf0] p-6"
        aria-describedby={undefined}
      >
        <DialogHeader className="pb-3 border-b border-[#f0f0f4]">
          <DialogTitle className="text-[18px] font-semibold text-[#1b1b1f]">
            Add competitor
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
          className="space-y-4 pt-2"
        >
          {/* Competitor search */}
          <div className="space-y-1.5">
            <label className="text-[12.5px] font-medium text-[#4b4b55]">Competitor</label>
            <div className="relative">
              <Input
                placeholder="Search competitors..."
                value={competitorSearch}
                onChange={(e) => {
                  setCompetitorSearch(e.target.value)
                  setShowDropdown(true)
                }}
                onFocus={() => setShowDropdown(true)}
                className="h-[38px] rounded-[9px] border-[#e6e6eb] bg-[#fafafb] text-[13.5px] text-[#1b1b1f] focus:border-[#1b1b1f] focus:bg-white"
              />
              {showDropdown && competitorsData && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[9px] border border-[#e6e6eb] bg-white shadow-lg">
                  {competitorsData.items.length === 0 ? (
                    <div className="px-3 py-2 text-[13px] text-[#8c8c96]">No competitors found</div>
                  ) : (
                    competitorsData.items.map((competitor) => (
                      <button
                        key={competitor.id}
                        type="button"
                        className={`w-full px-3 py-2 text-left text-[13px] hover:bg-[#f4f4f6] ${
                          selectedId === competitor.id
                            ? 'bg-[#f4f4f6] font-medium text-[#1b1b1f]'
                            : 'text-[#4b4b55]'
                        }`}
                        onClick={() => handleCompetitorSelect(competitor.id)}
                      >
                        {competitor.name}
                        {!competitor.isActive && (
                          <span className="ml-2 text-[12px] text-[#8c8c96]">Inactive</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {!selectedId && (
              <span className="text-[11.5px] text-[#8c8c96]">
                Pick a competitor from the list to add it to this deal.
              </span>
            )}
          </div>

          {/* Server error */}
          {addMutation.isError && (
            <p
              className="rounded-[9px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
              role="alert"
            >
              {addMutation.error instanceof Error
                ? addMutation.error.message
                : 'Failed to add competitor'}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-[#f0f0f4] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="h-[36px] rounded-[9px] border-[#e6e6eb] text-[#4b4b55] hover:bg-[#f4f4f6]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!selectedId || addMutation.isPending}
              className="h-[36px] rounded-[9px] border-[#1b1b1f] bg-[#1b1b1f] text-white hover:bg-black"
            >
              {addMutation.isPending ? 'Adding...' : 'Add to deal'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
