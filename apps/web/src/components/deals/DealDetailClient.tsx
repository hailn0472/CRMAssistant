'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Pencil, Trash2, ArrowLeft, User, Clock, Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { deleteDeal, moveDealToStage, getDealStages, updateDeal } from '@/services/deal.service'
import { useQuery } from '@tanstack/react-query'
import type { Deal } from '@/services/deal.service'

function StageBadge({
  stage,
}: {
  stage: { name: string; color: string } | null | undefined
}): React.JSX.Element | null {
  if (!stage) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
      style={{ backgroundColor: stage.color + '20', color: stage.color }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
      {stage.name}
    </span>
  )
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency || 'USD'} ${value.toLocaleString()}`
  }
}

type DealDetailClientProps = {
  deal: Deal
}

export function DealDetailClient({ deal }: DealDetailClientProps): React.JSX.Element {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [movingStage, setMovingStage] = useState(false)
  const [editingProbability, setEditingProbability] = useState(false)
  const [probabilityValue, setProbabilityValue] = useState(String(deal.probability))

  const { data: stages } = useQuery({
    queryKey: ['dealStages'],
    queryFn: getDealStages,
  })

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this deal?')) return
    setDeleting(true)
    try {
      await deleteDeal(deal.id)
      toast.success('Deal deleted')
      router.push('/deals')
      router.refresh()
    } catch {
      toast.error('Failed to delete deal')
    } finally {
      setDeleting(false)
    }
  }

  const handleStageChange = async (newStageId: string) => {
    if (newStageId === deal.stageId) return
    setMovingStage(true)
    try {
      await moveDealToStage(deal.id, newStageId)
      toast.success('Stage updated')
      router.refresh()
    } catch {
      toast.error('Failed to update stage')
    } finally {
      setMovingStage(false)
    }
  }

  const handleProbabilityUpdate = async () => {
    const parsed = parseInt(probabilityValue, 10)
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      toast.error('Probability must be between 0 and 100')
      return
    }
    if (parsed === deal.probability) {
      setEditingProbability(false)
      return
    }
    try {
      await updateDeal(deal.id, { probability: parsed })
      toast.success('Probability updated')
      setEditingProbability(false)
      router.refresh()
    } catch {
      toast.error('Failed to update probability')
      setProbabilityValue(String(deal.probability))
    }
  }

  return (
    <div className="space-y-6 p-6 text-slate-950">
      {/* Back button */}
      <div className="flex items-center gap-3">
        <Link
          href="/deals"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to deals
        </Link>
      </div>

      {/* Header Card */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-lg font-bold text-white shadow-sm">
                {deal.title.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {deal.title}
                  </h1>
                  <StageBadge stage={deal.stage} />
                </div>
                <p className="mt-1 text-xl font-medium text-slate-700">
                  {formatCurrency(deal.value, deal.currency)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                className="gap-1.5"
                onClick={() => router.push(`/deals/${deal.id}/edit`)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </CardHeader>

        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
          {/* Deal Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Deal Details
            </h3>
            <div className="space-y-3">
              <DetailRow label="Stage">
                <select
                  value={deal.stageId}
                  onChange={(e) => handleStageChange(e.target.value)}
                  disabled={movingStage}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  {stages?.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </DetailRow>
              <DetailRow label="Probability">
                <div className="flex items-center gap-2">
                  {editingProbability ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={probabilityValue}
                        onChange={(e) => setProbabilityValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleProbabilityUpdate()
                          if (e.key === 'Escape') {
                            setProbabilityValue(String(deal.probability))
                            setEditingProbability(false)
                          }
                        }}
                        className="h-8 w-20 rounded-md border border-slate-300 px-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleProbabilityUpdate}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-green-600 hover:bg-green-50"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setProbabilityValue(String(deal.probability))
                          setEditingProbability(false)
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingProbability(true)}
                      className="group inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-slate-100"
                    >
                      <span>{deal.probability}%</span>
                      <Pencil className="h-3 w-3 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  )}
                </div>
                <span className="mt-1 block text-xs text-slate-400 italic">
                  Moving this deal to another stage resets probability to the stage default.
                </span>
              </DetailRow>
              <DetailRow label="Expected close">
                {deal.expectedCloseDate ? (
                  new Date(deal.expectedCloseDate).toLocaleDateString()
                ) : (
                  <span className="italic text-slate-300">&mdash;</span>
                )}
              </DetailRow>
              <DetailRow label="Actual close">
                {deal.actualCloseDate ? (
                  new Date(deal.actualCloseDate).toLocaleDateString()
                ) : (
                  <span className="italic text-slate-300">&mdash;</span>
                )}
              </DetailRow>
            </div>
          </div>

          {/* Related */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Related
            </h3>
            <div className="space-y-3">
              <DetailRow label="Contact">
                {deal.contact ? (
                  <Link
                    href={`/contacts/${deal.contact.id}`}
                    className="inline-flex items-center gap-1.5 text-indigo-600 hover:underline"
                  >
                    <User className="h-3.5 w-3.5" />
                    {deal.contact.firstName} {deal.contact.lastName}
                  </Link>
                ) : (
                  <span className="italic text-slate-300">&mdash;</span>
                )}
              </DetailRow>
              <DetailRow label="Owner">
                {deal.owner ? (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    {deal.owner.firstName} {deal.owner.lastName}
                  </span>
                ) : (
                  <span className="italic text-slate-300">&mdash;</span>
                )}
              </DetailRow>
            </div>
          </div>

          {/* Metadata */}
          <div className="space-y-4 md:col-span-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Metadata
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetaItem
                icon={<Clock className="h-3.5 w-3.5" />}
                label="Created"
                value={new Date(deal.createdAt).toLocaleDateString()}
              />
              <MetaItem
                icon={<Clock className="h-3.5 w-3.5" />}
                label="Updated"
                value={new Date(deal.updatedAt).toLocaleDateString()}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-4">
      <span className="w-[120px] shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <div className="text-sm font-medium text-slate-900">{children}</div>
    </div>
  )
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
        {icon}
        {label}
      </div>
      <p className="mt-0.5 text-sm font-medium text-slate-900">{value}</p>
    </div>
  )
}
