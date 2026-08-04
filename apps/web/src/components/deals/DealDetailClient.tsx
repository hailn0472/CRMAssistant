'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Check, Pencil, X } from 'lucide-react'

import { deleteDeal, moveDealToStage, getDealStages, updateDeal } from '@/services/deal.service'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { StageBadge, formatCurrency } from '@/components/deals/deal-display'
import { DealLineItems } from './DealLineItems'
import { DealCompetitors } from './DealCompetitors'
import { DealCollaboration } from './DealCollaboration'
import { DealFormDrawer } from './DealFormDrawer'
import { WinLossDialog, WIN_LOSS_REASON_LABELS } from './WinLossDialog'
import { DealHealthBadge } from './DealHealthBadge'
import { SnoozeReminderDialog } from './SnoozeReminderDialog'
import { getDealHealth, unsnoozeDealReminder } from '@/services/deal-health.service'
import { HEALTH_SIGNAL_LABELS, formatSnoozedUntil } from '@/lib/deal-health-format'
import { usePermission } from '@/hooks/usePermission'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/date-format'
import type { Deal, DealStage } from '@/services/deal.service'
import type { WinLossReason } from '@/services/competitor.service'

type DealDetailClientProps = {
  deal: Deal
}

type WinLossTarget = {
  stageId: string
  stageName: string
  isWon: boolean
  isLost: boolean
}

function initials(value: string): string {
  const clean = value.trim()
  const parts = clean.split(/[—–-]/)
  if (parts.length > 1 && parts[0]?.trim() && parts[1]?.trim()) {
    const first = parts[0].trim().charAt(0)
    const second = parts[1].trim().charAt(0)
    return (first + second).toUpperCase()
  }
  const words = clean.split(/\s+/)
  const first = words[0]?.charAt(0) ?? ''
  const second = words[1]?.charAt(0) ?? ''
  return (first + second).toUpperCase() || '?'
}

export function DealDetailClient({ deal }: DealDetailClientProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [movingStage, setMovingStage] = useState(false)
  const [editingProbability, setEditingProbability] = useState(false)
  const [probabilityValue, setProbabilityValue] = useState(String(deal.probability))
  const [winLossTarget, setWinLossTarget] = useState<WinLossTarget | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [unsnoozing, setUnsnoozing] = useState(false)
  const canSnooze = usePermission('DEAL', 'UPDATE')

  const { data: stages } = useQuery({
    queryKey: ['dealStages'],
    queryFn: getDealStages,
  })

  const { data: dealHealth } = useQuery({
    queryKey: ['dealHealth', deal.id],
    queryFn: () => getDealHealth(deal.id),
  })

  const handleUnsnooze = async (): Promise<void> => {
    setUnsnoozing(true)
    try {
      await unsnoozeDealReminder(deal.id)
      toast.success('Reminders resumed')
      queryClient.invalidateQueries({ queryKey: ['dealHealth', deal.id] })
    } catch {
      toast.error('Failed to unsnooze reminders')
    } finally {
      setUnsnoozing(false)
    }
  }

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
    // Intercept closed-stage moves: the WinLossDialog records the reason and
    // performs the move atomically — nothing moves until the user confirms.
    const targetStage = stages?.find((stage: DealStage) => stage.id === newStageId)
    if (targetStage && (targetStage.isWon || targetStage.isLost)) {
      setWinLossTarget({
        stageId: targetStage.id,
        stageName: targetStage.name,
        isWon: targetStage.isWon,
        isLost: targetStage.isLost,
      })
      return
    }
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

  const handleReopen = async (): Promise<void> => {
    // Reopening has no stored "previous stage" to return to, so we land on the
    // last non-terminal stage in pipeline order (e.g. Negotiation) — the same
    // fallback the design prototype uses.
    const targetStage = [...orderedStages].reverse().find((stage) => !stage.isWon && !stage.isLost)
    if (!targetStage) return
    setMovingStage(true)
    try {
      await moveDealToStage(deal.id, targetStage.id)
      toast.success('Deal reopened', { id: 'deal-reopened' })
      router.refresh()
    } catch {
      toast.error('Failed to reopen deal')
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

  // The mock's stage rail, driven by the real pipeline order. Everything up to
  // and including the current stage is filled; a closed-lost deal fills red.
  // The rail only ever shows one terminal stage — whichever the deal actually
  // reached — so a lost deal doesn't display an unreached "Closed won" slot.
  const orderedStages = [...(stages ?? [])].sort((a, b) => a.order - b.order)
  const railStages = orderedStages.filter((stage) => {
    if (deal.stage?.isLost && stage.isWon) return false
    if (deal.stage?.isWon && stage.isLost) return false
    return true
  })
  const currentIndex = railStages.findIndex((stage) => stage.id === deal.stageId)
  const railColor = deal.stage?.isLost ? '#d98a8a' : '#1b1b1f'

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <Link
        href="/deals"
        className="mb-4 inline-flex items-center gap-[7px] text-[12.5px] text-[#8c8c96] transition-colors hover:text-[#1b1b1f]"
      >
        ← Back to deals
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-[#f0f0f3] text-[14px] font-semibold text-[#4b4b55]">
            {initials(deal.title)}
          </div>
          <div className="flex min-w-0 flex-col gap-[7px]">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
                {deal.title}
              </h1>
              {deal.stage?.isWon ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cdead9] bg-[#f0faf5] py-[3px] pl-2 pr-2.5 text-[11.5px] font-semibold text-[#22a06b]">
                  <span className="block h-[5px] w-[5px] rounded-full bg-[#22a06b]" />
                  {deal.stage.name}
                </span>
              ) : deal.stage?.isLost ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f0d5d5] bg-[#fdf2f2] py-[3px] pl-2 pr-2.5 text-[11.5px] font-semibold text-[#b91c1c]">
                  <span className="block h-[5px] w-[5px] rounded-full bg-[#b91c1c]" />
                  {deal.stage.name.toLowerCase() === 'closed lost'
                    ? 'Closed lost'
                    : deal.stage.name}
                </span>
              ) : (
                <StageBadge stage={deal.stage} />
              )}
              <DealHealthBadge health={dealHealth ?? null} />
            </div>
            <div className="flex flex-wrap items-center gap-3.5 text-[13px] text-[#77777f]">
              <span className="font-mono text-[15px] font-medium text-[#1b1b1f]">
                {formatCurrency(deal.value, deal.currency)}
              </span>
              {deal.actualCloseDate ? (
                <>
                  <span className="text-[#d8d8e0]">·</span>
                  <span>Closed {formatDate(deal.actualCloseDate)}</span>
                </>
              ) : deal.expectedCloseDate ? (
                <>
                  <span className="text-[#d8d8e0]">·</span>
                  <span>Expected close {formatDate(deal.expectedCloseDate)}</span>
                </>
              ) : null}
              {deal.owner ? (
                <>
                  <span className="text-[#d8d8e0]">·</span>
                  <span>
                    Owner {deal.owner.firstName} {deal.owner.lastName}
                  </span>
                </>
              ) : null}
            </div>
            {dealHealth && dealHealth.signals.length > 0 ? (
              <p className="text-[12.5px] text-[#8c8c96]">
                {dealHealth.signals
                  .map((signal) => HEALTH_SIGNAL_LABELS[signal] ?? signal)
                  .join(' · ')}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-2">
          {canSnooze && dealHealth ? (
            dealHealth.snoozedUntil ? (
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] text-[#77777f]">
                  Reminders snoozed until{' '}
                  <strong className="font-medium text-[#1b1b1f]">
                    {formatSnoozedUntil(dealHealth.snoozedUntil)}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={handleUnsnooze}
                  disabled={unsnoozing}
                  className="inline-flex h-9 items-center rounded-[9px] px-3 text-[13px] font-medium text-[#4338ca] transition-colors hover:bg-[#f4f4f6] disabled:opacity-60"
                >
                  {unsnoozing ? 'Unsnoozing...' : 'Unsnooze'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSnoozeOpen(true)}
                className="inline-flex h-9 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
              >
                Snooze reminders
              </button>
            )
          ) : null}
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex h-9 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            Edit
          </button>
          {deal.stage?.isWon || deal.stage?.isLost ? (
            <button
              type="button"
              onClick={handleReopen}
              disabled={movingStage}
              className="inline-flex h-9 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
            >
              {movingStage ? 'Reopening...' : 'Reopen deal'}
            </button>
          ) : null}
        </div>
      </div>

      {railStages.length > 0 ? (
        <div className="mb-[22px] flex gap-[5px]">
          {railStages.map((stage, index) => {
            const reached = currentIndex >= 0 && index <= currentIndex
            return (
              <div key={stage.id} className="flex flex-1 flex-col gap-1.5">
                <span
                  className="block h-1 rounded-[3px]"
                  style={{ background: reached ? railColor : '#ececf0' }}
                />
                <span
                  className={cn(
                    'text-[11.5px]',
                    index === currentIndex
                      ? 'font-semibold text-[#1b1b1f]'
                      : 'font-medium text-[#a0a0aa]',
                  )}
                >
                  {stage.name.toLowerCase() === 'closed lost' ? 'Closed lost' : stage.name}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <DealLineItems dealId={deal.id} currency={deal.currency} />
          <DealCompetitors dealId={deal.id} />
          <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
            <DealCollaboration dealId={deal.id} contactId={deal.contactId} />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
            <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Deal details</h2>

            <DetailRow label="Stage">
              <select
                value={deal.stageId}
                onChange={(e) => handleStageChange(e.target.value)}
                disabled={movingStage}
                aria-label="Deal stage"
                className="h-[22px] cursor-pointer rounded border-0 bg-transparent p-0 text-right text-[13px] font-medium text-[#1b1b1f] outline-none transition-colors hover:bg-[#f4f4f6]"
              >
                {stages?.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name.toLowerCase() === 'closed lost' ? 'Closed lost' : stage.name}
                  </option>
                ))}
              </select>
            </DetailRow>

            <DetailRow label="Probability">
              {editingProbability ? (
                <span className="flex items-center gap-1.5">
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
                    className="h-8 w-16 rounded-[8px] border border-[#e6e6eb] bg-[#fafafb] px-2 text-[13px] text-[#1b1b1f] outline-none focus:border-[#1b1b1f] focus:bg-white"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleProbabilityUpdate}
                    aria-label="Save probability"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#22a06b] transition-colors hover:bg-[#f4f4f6]"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProbabilityValue(String(deal.probability))
                      setEditingProbability(false)
                    }}
                    aria-label="Cancel probability edit"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#a0a0aa] transition-colors hover:bg-[#f4f4f6]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingProbability(true)}
                  aria-label="Edit probability"
                  className="group inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 transition-colors hover:bg-[#f4f4f6]"
                >
                  <span>{deal.probability}%</span>
                  <Pencil className="h-3 w-3 text-[#c7c7d1] opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}
            </DetailRow>

            <DetailRow label="Value">
              {formatCurrency(deal.value, deal.currency)} {deal.currency ?? 'USD'}
            </DetailRow>

            <DetailRow label="Expected close">
              {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : <Dash />}
            </DetailRow>
            <DetailRow label="Actual close">
              {deal.actualCloseDate ? formatDate(deal.actualCloseDate) : <Dash />}
            </DetailRow>
            {deal.winLossReason ? (
              <DetailRow label={deal.stage?.isWon ? 'Win reason' : 'Loss reason'}>
                {deal.winLossReason === 'BUDGET' || deal.winLossReason === 'Budget'
                  ? 'Budget cut'
                  : WIN_LOSS_REASON_LABELS[deal.winLossReason as WinLossReason] ??
                    deal.winLossReason}
              </DetailRow>
            ) : null}

            <p className="mt-0.5 text-[11.5px] text-[#a0a0aa]">
              Moving this deal to another stage resets probability to the stage default.
            </p>
          </section>

          <section className="flex flex-col gap-[13px] rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
            <h2 className="text-[14px] font-semibold text-[#1b1b1f]">People</h2>
            {deal.contact ? (
              <PersonRow
                initials={initials(`${deal.contact.firstName} ${deal.contact.lastName}`)}
                name={`${deal.contact.firstName} ${deal.contact.lastName}`}
                caption="Primary contact"
                href={`/contacts/${deal.contact.id}`}
              />
            ) : (
              <EmptyPerson label="No contact linked" />
            )}
            {deal.owner ? (
              <PersonRow
                initials={initials(`${deal.owner.firstName} ${deal.owner.lastName}`)}
                name={`${deal.owner.firstName} ${deal.owner.lastName}`}
                caption="Deal owner"
              />
            ) : (
              <EmptyPerson label="No owner assigned" />
            )}
          </section>

          <section className="flex flex-col gap-2.5 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
            <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Record</h2>
            <MetaRow label="Created" value={formatDate(deal.createdAt)} />
            <MetaRow label="Last updated" value={formatDate(deal.updatedAt)} />
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="mt-1 inline-flex h-8 items-center self-start rounded-[8px] border border-[#e6e6eb] bg-white px-3 text-[12.5px] font-medium text-[#b91c1c] transition-colors hover:border-[#f0d5d5] hover:bg-[#fdf2f2] disabled:opacity-60"
            >
              {deleting ? 'Deleting...' : 'Delete deal'}
            </button>
          </section>
        </aside>
      </div>

      <WinLossDialog
        dealId={deal.id}
        stageId={winLossTarget?.stageId ?? ''}
        stageName={winLossTarget?.stageName ?? ''}
        isWon={winLossTarget?.isWon ?? false}
        isLost={winLossTarget?.isLost ?? false}
        open={winLossTarget !== null}
        onOpenChange={(open) => {
          if (!open) setWinLossTarget(null)
        }}
      />

      <SnoozeReminderDialog dealId={deal.id} open={snoozeOpen} onOpenChange={setSnoozeOpen} />

      <DealFormDrawer
        open={editOpen}
        onOpenChange={setEditOpen}
        deal={deal}
        onSaved={() => {
          setEditOpen(false)
          router.refresh()
        }}
      />
    </div>
  )
}

function Dash(): React.JSX.Element {
  return <span className="text-[#a0a0aa]">&mdash;</span>
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3.5 text-[13px]">
      <span className="flex-none text-[#8c8c96]">{label}</span>
      <span className="text-right font-medium text-[#1b1b1f]">{children}</span>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3.5 text-[12.5px]">
      <span className="text-[#8c8c96]">{label}</span>
      <span className="font-mono text-[#1b1b1f]">{value}</span>
    </div>
  )
}

function PersonRow({
  initials: init,
  name,
  caption,
  href,
}: {
  initials: string
  name: string
  caption: string
  href?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[11px]">
      <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-[#f0f0f3] text-[10.5px] font-semibold text-[#4b4b55]">
        {init}
      </span>
      <div className="flex min-w-0 flex-col gap-px">
        {href ? (
          <Link
            href={href}
            className="truncate text-[13px] font-medium text-[#4338ca] hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate text-[13px] font-medium text-[#1b1b1f]">{name}</span>
        )}
        <span className="text-[11.5px] text-[#a0a0aa]">{caption}</span>
      </div>
    </div>
  )
}

function EmptyPerson({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-[11px]">
      <span className="block h-[30px] w-[30px] flex-none rounded-full border border-dashed border-[#d8d8e0]" />
      <div className="flex min-w-0 flex-col gap-px">
        <span className="text-[13px] font-medium text-[#8c8c96]">{label}</span>
        <span className="text-[11.5px] text-[#a0a0aa]">&mdash;</span>
      </div>
    </div>
  )
}
