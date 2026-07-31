'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import {
  getDeals,
  getDealPipelineSummary,
  moveDealToStage,
  getDealStages,
  ON_DEAL_UPDATED_SUBSCRIPTION,
} from '@/services/deal.service'
import type { DealFilter, DealStageSummary } from '@/services/deal.service'
import { PipelineColumn } from './PipelineColumn'
import { DealCard } from './DealCard'
import { WinLossDialog } from './WinLossDialog'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { useAuthStore } from '@/stores/auth.store'

interface PipelineDeal {
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

type WinLossTarget = {
  dealId: string
  stageId: string
  stageName: string
  isWon: boolean
  isLost: boolean
}

function StageColumn({
  stage,
  filter,
  summary,
  stages,
  onMoveToStage,
}: {
  stage: {
    id: string
    name: string
    color: string
    order: number
    probability: number
    isWon: boolean
    isLost: boolean
  }
  filter: DealFilter
  summary: DealStageSummary | undefined
  stages: {
    id: string
    name: string
    color: string
    order: number
    probability: number
    isWon: boolean
    isLost: boolean
  }[]
  onMoveToStage: (dealId: string, stageId: string) => void
}): React.JSX.Element {
  const { data: deals } = useQuery({
    queryKey: ['deals', 'pipeline', stage.id, filter],
    queryFn: () =>
      getDeals(1, 100, { ...filter, stageId: stage.id }).then((res) => res.items as PipelineDeal[]),
  })

  return (
    <PipelineColumn
      stage={stage}
      deals={deals ?? []}
      totalValue={summary?.totalValue ?? 0}
      count={summary?.count ?? (deals ?? []).length}
      isWon={stage.isWon}
      isLost={stage.isLost}
      stages={stages}
      onMoveToStage={onMoveToStage}
    />
  )
}

export function PipelineBoard(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<DealFilter>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [winLossTarget, setWinLossTarget] = useState<WinLossTarget | null>(null)
  const currentUserId = useAuthStore((s) => s.user?.userId)
  const subClientRef = useRef<GraphqlSubscriptionClient | null>(null)

  // Subscription lifecycle
  useEffect(() => {
    const client = new GraphqlSubscriptionClient()
    subClientRef.current = client
    client.connect().catch(() => {})

    const unsub = client.subscribe('deals:updates', {
      query: ON_DEAL_UPDATED_SUBSCRIPTION,
      variables: {},
      onData: (_data: unknown) => {
        // Note: DealRef subscription payload doesn't include updatedBy field,
        // so we skip own-user filtering. Optimistic update + invalidate query
        // is idempotent and harmless when the current user is the updater.
        queryClient.invalidateQueries({ queryKey: ['deals', 'pipeline'] })
        queryClient.invalidateQueries({ queryKey: ['deals', 'pipelineSummary'] })
      },
    })

    return () => {
      unsub()
      client.disconnect()
      subClientRef.current = null
    }
  }, [currentUserId, queryClient])

  // Fetch stages
  const {
    data: stages,
    isLoading: stagesLoading,
    error: stagesError,
    refetch: refetchStages,
  } = useQuery({
    queryKey: ['dealStages'],
    queryFn: getDealStages,
  })

  // Fetch pipeline summary
  const { data: summary } = useQuery({
    queryKey: ['deals', 'pipelineSummary', filter],
    queryFn: () => getDealPipelineSummary(filter),
    enabled: !!stages,
  })

  // Build map of stageId -> summary data
  const summaryMap = new Map<string, DealStageSummary>()
  for (const s of summary ?? []) {
    summaryMap.set(s.stageId, s)
  }

  // Find which stage a deal belongs to by reading from the query cache
  const findStageForDeal = useCallback(
    (dealId: string): string | null => {
      if (!stages) return null
      for (const stage of stages) {
        const cacheKey = ['deals', 'pipeline', stage.id, filter]
        const deals = queryClient.getQueryData(cacheKey) as PipelineDeal[] | undefined
        if (deals?.some((d) => d.id === dealId)) return stage.id
      }
      return null
    },
    [stages, filter, queryClient],
  )

  // Move mutation with optimistic update
  const moveMutation = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      moveDealToStage(dealId, stageId),
    onMutate: async ({ dealId, stageId: targetStageId }) => {
      const sourceStageId = findStageForDeal(dealId)
      if (!sourceStageId || sourceStageId === targetStageId) return

      // Cancel outgoing queries for both columns
      const sourceKey = ['deals', 'pipeline', sourceStageId, filter]
      const targetKey = ['deals', 'pipeline', targetStageId, filter]
      const summaryKey = ['deals', 'pipelineSummary', filter]

      await Promise.all([
        queryClient.cancelQueries({ queryKey: sourceKey }),
        queryClient.cancelQueries({ queryKey: targetKey }),
        queryClient.cancelQueries({ queryKey: summaryKey }),
      ])

      // Snapshot current data
      const sourceSnapshot = queryClient.getQueryData(sourceKey)
      const targetSnapshot = queryClient.getQueryData(targetKey)
      const summarySnapshot = queryClient.getQueryData(summaryKey)

      // Optimistically move the deal
      const sourceDeals = (queryClient.getQueryData(sourceKey) as PipelineDeal[] | undefined) ?? []
      const dealToMove = sourceDeals.find((d) => d.id === dealId)
      if (!dealToMove) return { sourceSnapshot, targetSnapshot, summarySnapshot }

      const updatedDeal = { ...dealToMove, stageId: targetStageId }
      const newSourceDeals = sourceDeals.filter((d) => d.id !== dealId)
      const targetDeals = (queryClient.getQueryData(targetKey) as PipelineDeal[] | undefined) ?? []

      queryClient.setQueryData(sourceKey, newSourceDeals)
      queryClient.setQueryData(targetKey, [updatedDeal, ...targetDeals])

      // Optimistically adjust summary
      const oldSummary = queryClient.getQueryData(summaryKey) as DealStageSummary[] | undefined
      if (oldSummary) {
        const newSummary = oldSummary.map((s) => {
          if (s.stageId === sourceStageId) {
            return {
              ...s,
              count: Math.max(0, s.count - 1),
              totalValue: Math.max(0, s.totalValue - dealToMove.value),
            }
          }
          if (s.stageId === targetStageId) {
            return { ...s, count: s.count + 1, totalValue: s.totalValue + dealToMove.value }
          }
          return s
        })
        queryClient.setQueryData(summaryKey, newSummary)
      }

      return { sourceSnapshot, targetSnapshot, summarySnapshot }
    },
    onError: (_err, { dealId, stageId }, context) => {
      // Rollback
      if (context?.sourceSnapshot) {
        const sourceStageId = findStageForDeal(dealId)
        if (sourceStageId) {
          queryClient.setQueryData(
            ['deals', 'pipeline', sourceStageId, filter],
            context.sourceSnapshot,
          )
        }
      }
      if (context?.targetSnapshot) {
        queryClient.setQueryData(['deals', 'pipeline', stageId, filter], context.targetSnapshot)
      }
      if (context?.summarySnapshot) {
        queryClient.setQueryData(['deals', 'pipelineSummary', filter], context.summarySnapshot)
      }
      toast.error('Failed to move deal. Please try again.')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] })
    },
  })

  // Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null)
      const { active, over } = event
      if (!over) return

      const dealId = active.id as string
      const targetStageId = over.id as string
      const sourceStageId = findStageForDeal(dealId)

      if (!sourceStageId || sourceStageId === targetStageId) return

      // Intercept closed-stage drops: open WinLossDialog instead of moving.
      // recordWinLoss performs the move atomically; cancelling is a no-op.
      const targetStage = stages?.find((s) => s.id === targetStageId)
      if (targetStage && (targetStage.isWon || targetStage.isLost)) {
        setWinLossTarget({
          dealId,
          stageId: targetStage.id,
          stageName: targetStage.name,
          isWon: targetStage.isWon,
          isLost: targetStage.isLost,
        })
        return
      }

      moveMutation.mutate({ dealId, stageId: targetStageId })
    },
    [findStageForDeal, moveMutation, stages],
  )

  const handleMoveToStage = useCallback(
    (dealId: string, stageId: string) => {
      // Keyboard / card-menu path: same closed-stage interception (AC #27)
      const targetStage = stages?.find((s) => s.id === stageId)
      if (targetStage && (targetStage.isWon || targetStage.isLost)) {
        setWinLossTarget({
          dealId,
          stageId: targetStage.id,
          stageName: targetStage.name,
          isWon: targetStage.isWon,
          isLost: targetStage.isLost,
        })
        return
      }
      moveMutation.mutate({ dealId, stageId })
    },
    [moveMutation, stages],
  )

  // Find the active deal for drag overlay
  const activeDeal =
    activeId && stages
      ? (() => {
          for (const stage of stages) {
            const cacheKey = ['deals', 'pipeline', stage.id, filter]
            const deals = queryClient.getQueryData(cacheKey) as PipelineDeal[] | undefined
            const found = deals?.find((d) => d.id === activeId)
            if (found) return found
          }
          return null
        })()
      : null

  // Loading state
  if (stagesLoading) {
    return <TableSkeleton rows={5} columns={3} />
  }

  // Error state
  if (stagesError) {
    return (
      <ErrorState
        message={stagesError instanceof Error ? stagesError.message : 'Failed to load pipeline'}
        onRetry={() => refetchStages()}
      />
    )
  }

  // Empty state when no stages
  if (!stages || stages.length === 0) {
    return (
      <EmptyState
        title="No stages configured"
        description="Pipeline stages have not been set up yet."
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter bar — owner, contact, expected close date, stage */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Owner ID..."
          value={filter.ownerId ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, ownerId: e.target.value || undefined }))}
          className="h-9 w-40 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          aria-label="Filter by owner"
        />
        <input
          type="text"
          placeholder="Contact ID..."
          value={filter.contactId ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, contactId: e.target.value || undefined }))}
          className="h-9 w-40 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          aria-label="Filter by contact"
        />
        <input
          type="date"
          value={filter.expectedCloseDateFrom ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, expectedCloseDateFrom: e.target.value || undefined }))
          }
          className="h-9 w-44 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          aria-label="Expected close date from"
        />
        <input
          type="date"
          value={filter.expectedCloseDateTo ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, expectedCloseDateTo: e.target.value || undefined }))
          }
          className="h-9 w-44 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          aria-label="Expected close date to"
        />
        <input
          type="text"
          placeholder="Stage ID..."
          value={filter.stageId ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, stageId: e.target.value || undefined }))}
          className="h-9 w-40 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          aria-label="Filter by stage"
        />
      </div>

      {/* Board */}
      <div className="overflow-x-auto">
        <div className="flex gap-4 pb-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                filter={filter}
                summary={summaryMap.get(stage.id)}
                stages={stages}
                onMoveToStage={handleMoveToStage}
              />
            ))}
            <DragOverlay dropAnimation={null}>
              {activeDeal ? (
                <div className="w-72 rotate-3 shadow-xl">
                  <DealCard deal={activeDeal} stages={stages} onMoveToStage={handleMoveToStage} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      <WinLossDialog
        dealId={winLossTarget?.dealId ?? ''}
        stageId={winLossTarget?.stageId ?? ''}
        stageName={winLossTarget?.stageName ?? ''}
        isWon={winLossTarget?.isWon ?? false}
        isLost={winLossTarget?.isLost ?? false}
        open={winLossTarget !== null}
        onOpenChange={(open) => {
          if (!open) setWinLossTarget(null)
        }}
      />
    </div>
  )
}
