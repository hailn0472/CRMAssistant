'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, GripVertical, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getDealStages,
  createDealStage,
  deleteDealStage,
  reorderDealStages,
} from '@/services/deal.service'
import type { DealStage } from '@/services/deal.service'
import { useAuthStore } from '@/stores/auth.store'

export default function PipelineSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)

  // Redirect non-ADMIN users
  useEffect(() => {
    if (user && !user.roles.includes('ADMIN')) {
      router.replace('/deals')
    }
  }, [user, router])

  const [newStageName, setNewStageName] = useState('')
  const [newStageColor, setNewStageColor] = useState('#3B82F6')
  const [isAdding, setIsAdding] = useState(false)

  const {
    data: stages,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['dealStages'],
    queryFn: getDealStages,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newStageName.trim()) throw new Error('Stage name is required')
      return createDealStage(newStageName.trim(), newStageColor)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealStages'] })
      setNewStageName('')
      setNewStageColor('#3B82F6')
      setIsAdding(false)
      toast.success('Stage created')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create stage')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDealStage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealStages'] })
      toast.success('Stage deleted')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete stage')
    },
  })

  const [isReordering, setIsReordering] = useState(false)
  const [orderedIds, setOrderedIds] = useState<string[]>([])

  const startReordering = () => {
    if (!stages) return
    setOrderedIds(stages.map((s) => s.id))
    setIsReordering(true)
  }

  const saveReordering = async () => {
    try {
      await reorderDealStages(orderedIds)
      queryClient.invalidateQueries({ queryKey: ['dealStages'] })
      setIsReordering(false)
      toast.success('Stages reordered')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reorder stages')
    }
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    const ids = [...orderedIds]
    ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
    setOrderedIds(ids)
  }

  const moveDown = (index: number) => {
    if (index === orderedIds.length - 1) return
    const ids = [...orderedIds]
    ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
    setOrderedIds(ids)
  }

  const displayStages = isReordering
    ? (orderedIds.map((id) => stages?.find((s) => s.id === id)).filter(Boolean) as DealStage[])
    : stages ?? []

  if (isLoading) return <div className="p-6 text-slate-500">Loading stages...</div>
  if (error) return <div className="p-6 text-red-500">Failed to load stages</div>

  return (
    <div className="space-y-6 p-6 text-slate-950">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pipeline Settings
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Customize the sales pipeline stages for your team.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isReordering ? (
            <>
              <Button variant="outline" onClick={() => setIsReordering(false)}>
                Cancel
              </Button>
              <Button onClick={saveReordering} className="gap-1.5">
                <Check className="h-3.5 w-3.5" />
                Save order
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={startReordering}>
                Reorder
              </Button>
              <Button onClick={() => setIsAdding(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add stage
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-base">Pipeline Stages</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-slate-100">
            {displayStages.map((stage, index) => (
              <div key={stage.id} className="flex items-center gap-4 px-6 py-4">
                {isReordering ? (
                  <>
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        className="h-5 w-5 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(index)}
                        disabled={index === displayStages.length - 1}
                        className="h-5 w-5 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </div>
                    <GripVertical className="h-4 w-4 text-slate-300" />
                  </>
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-500">
                    {stage.order + 1}
                  </span>
                )}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{stage.name}</p>
                    <p className="text-xs text-slate-400">
                      Probability: {stage.probability}%{stage.isWon ? ' • Won' : ''}
                      {stage.isLost ? ' • Lost' : ''}
                    </p>
                  </div>
                </div>
                {!isReordering && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-red-600"
                    onClick={() => {
                      if (confirm(`Delete stage "${stage.name}"?`)) {
                        deleteMutation.mutate(stage.id)
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            {isAdding && (
              <div className="flex items-center gap-4 px-6 py-4 bg-indigo-50/50">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-600">
                  +
                </span>
                <div className="flex items-center gap-3 flex-1">
                  <input
                    type="color"
                    value={newStageColor}
                    onChange={(e) => setNewStageColor(e.target.value)}
                    className="h-8 w-8 rounded border border-slate-300 p-0.5"
                  />
                  <input
                    type="text"
                    placeholder="Stage name"
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    className="h-9 flex-1 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createMutation.mutate()
                      if (e.key === 'Escape') setIsAdding(false)
                    }}
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isPending}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => {
                      setIsAdding(false)
                      setNewStageName('')
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
