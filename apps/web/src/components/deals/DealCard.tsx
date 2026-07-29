'use client'

import Link from 'next/link'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import { useState, useCallback } from 'react'

import { formatCurrency, StageBadge } from './deal-display'
import type { DealStage } from '@/services/deal.service'

interface DealCardDeal {
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

interface DealCardProps {
  deal: DealCardDeal
  stages: DealStage[]
  onMoveToStage: (dealId: string, stageId: string) => void
}

export function DealCard({ deal, stages, onMoveToStage }: DealCardProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { stageId: deal.stageId, deal },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    visibility: isDragging ? ('hidden' as const) : ('visible' as const), // Hidden but preserves layout space — DragOverlay handles visual
  }

  const ownerInitials = deal.owner
    ? `${deal.owner.firstName.charAt(0)}${deal.owner.lastName.charAt(0)}`
    : '??'

  const ownerAvatar = deal.owner?.avatar ? (
    <img
      src={deal.owner.avatar}
      alt={`${deal.owner.firstName} ${deal.owner.lastName}`}
      className="h-6 w-6 rounded-full object-cover"
    />
  ) : (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-700">
      {ownerInitials}
    </div>
  )

  const otherStages = stages.filter((s) => s.id !== deal.stageId)

  const handleMenuToggle = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuOpen((prev) => !prev)
  }, [])

  const handleMoveToStage = useCallback(
    (stageId: string) => {
      setMenuOpen(false)
      onMoveToStage(deal.id, stageId)
    },
    [deal.id, onMoveToStage],
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md min-h-[44px] min-w-[44px] cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <Link
          href={`/deals/${deal.id}`}
          className="font-medium text-slate-900 hover:text-indigo-600 transition-colors text-sm leading-snug"
          onClick={(e) => e.stopPropagation()}
        >
          {deal.title}
        </Link>
        <button
          type="button"
          onClick={handleMenuToggle}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 transition-opacity focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          aria-label="Move to stage"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {menuOpen && (
        <div className="absolute right-0 top-8 z-50 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Move to stage
          </div>
          {otherStages.map((stage) => (
            <button
              key={stage.id}
              type="button"
              onClick={() => handleMoveToStage(stage.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
              {stage.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">
          {formatCurrency(deal.value, deal.currency)}
        </span>
      </div>

      {deal.contact && (
        <p className="mt-1 text-xs text-slate-500">
          {deal.contact.firstName} {deal.contact.lastName}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <StageBadge stage={deal.stage} />
        {ownerAvatar}
      </div>

      <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="h-4 w-4 text-slate-300" />
      </div>
    </div>
  )
}
