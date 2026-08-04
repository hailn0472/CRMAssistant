'use client'

import { useDroppable } from '@dnd-kit/core'

import { DealCard } from './DealCard'
import { formatCurrency } from './deal-display'
import type { DealStage } from '@/services/deal.service'

interface PipelineColumnDeal {
  id: string
  title: string
  value: number
  currency: string
  stageId: string
  stage?: { id: string; name: string; color: string } | null
  contact?: { id: string; firstName: string; lastName: string; email: string } | null
  owner?: {
    id: string
    firstName: string
    lastName: string
    email: string
    avatar?: string | null
  } | null
}

interface PipelineColumnProps {
  stage: DealStage
  deals: PipelineColumnDeal[]
  totalValue: number
  count: number
  isWon?: boolean
  isLost?: boolean
  stages: DealStage[]
  onMoveToStage: (dealId: string, stageId: string) => void
}

export function PipelineColumn({
  stage,
  deals,
  totalValue,
  count,
  isWon,
  isLost,
  stages,
  onMoveToStage,
}: PipelineColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    data: { stage },
  })

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-[12px] bg-[#f4f4f6] border border-[#e6e6eb]/60">
      {/* Sticky header */}
      <div
        ref={setNodeRef}
        className="sticky top-0 z-10 rounded-t-[12px] border-b border-[#e6e6eb] bg-[#f4f4f6] px-3.5 py-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: stage.color }}
            />
            <span className="text-[13.5px] font-semibold text-[#1b1b1f]">{stage.name}</span>
            {isWon && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                Won
              </span>
            )}
            {isLost && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                Lost
              </span>
            )}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12px] text-[#8c8c96]">
          <span>
            <strong className="font-semibold text-[#4b4b55]">{count}</strong> deals
          </span>
          <span className="text-[#b4b4bd]">·</span>
          <span className="font-mono text-[#4b4b55]">{formatCurrency(totalValue, 'USD')}</span>
        </div>
      </div>

      {/* Deal cards */}
      <div
        className={`flex-1 space-y-2.5 overflow-y-auto p-3 transition-colors ${
          isOver ? 'bg-[#ececf0]' : ''
        }`}
        style={{ maxHeight: 'calc(100vh - 240px)' }}
      >
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} stages={stages} onMoveToStage={onMoveToStage} />
        ))}

        {deals.length === 0 && (
          <p className="py-8 text-center text-[12.5px] text-[#8c8c96]">No deals</p>
        )}
      </div>
    </div>
  )
}
