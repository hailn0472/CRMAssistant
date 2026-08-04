'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getWinLossAnalysis } from '@/services/win-loss.service'
import type { WinLossFilter } from '@/services/win-loss.service'
import { WinLossSummary } from './WinLossSummary'
import { LossReasonsChart } from './LossReasonsChart'
import { CompetitorComparisonTable } from './CompetitorComparisonTable'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { ErrorState } from '@/components/shared/ErrorState'
import { EmptyState } from '@/components/shared/EmptyState'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { ON_DEAL_UPDATED_SUBSCRIPTION } from '@/services/deal.service'
import {
  formatDateInput,
  startOfCurrentQuarterUtc,
  startOfCurrentYearUtc,
  startOfLast30DaysUtc,
  todayUtc,
  winLossAnalysisToCsv,
} from '@/lib/win-loss-format'
import { cn } from '@/lib/utils'

const QUICK_RANGES = [
  { label: 'Last 30 days', start: startOfLast30DaysUtc },
  { label: 'This quarter', start: startOfCurrentQuarterUtc },
  { label: 'This year', start: startOfCurrentYearUtc },
] as const

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function WinLossReport(): React.JSX.Element {
  const queryClient = useQueryClient()
  const clientRef = useRef<GraphqlSubscriptionClient | null>(null)
  const connectGuardRef = useRef(false)

  // Filters — default to the start of the current UTC quarter → today
  const [startDate, setStartDate] = useState(() => formatDateInput(startOfCurrentQuarterUtc()))
  const [endDate, setEndDate] = useState(() => formatDateInput(todayUtc()))

  const filter: WinLossFilter = { startDate, endDate }

  const analysisQuery = useQuery({
    queryKey: ['winLoss', filter],
    queryFn: () => getWinLossAnalysis(filter),
  })

  // Real-time subscription — reuses the existing ON_DEAL_UPDATED channel
  const handleDealUpdate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['winLoss'] })
  }, [queryClient])

  useEffect(() => {
    if (connectGuardRef.current) return
    connectGuardRef.current = true

    const client = new GraphqlSubscriptionClient()
    clientRef.current = client

    client.connect()

    client.subscribe('onDealUpdated', {
      query: ON_DEAL_UPDATED_SUBSCRIPTION,
      variables: {},
      onData: handleDealUpdate,
    })

    return () => {
      connectGuardRef.current = false
      client.disconnect()
      clientRef.current = null
    }
  }, [handleDealUpdate])

  const isLoading = analysisQuery.isLoading
  const error = analysisQuery.error

  function selectQuickRange(start: (now?: Date) => Date): void {
    setStartDate(formatDateInput(start()))
    setEndDate(formatDateInput(todayUtc()))
  }

  function handleExport(): void {
    if (!analysisQuery.data) return
    const csv = winLossAnalysisToCsv(analysisQuery.data)
    downloadCsv(csv, `win-loss-${startDate}-to-${endDate}.csv`)
  }

  const today = formatDateInput(todayUtc())

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
            Win / Loss
          </h1>
          <p className="max-w-[60ch] text-[13.5px] text-[#77777f]">
            Closed deals counted by actual close date. Amounts are summed without currency
            conversion.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!analysisQuery.data}
          className="inline-flex h-9 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:pointer-events-none disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <section
        aria-label="Win/Loss Report Filters"
        className="flex flex-wrap items-end gap-3.5 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Start Date</span>
          <input
            id="win-loss-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f] focus:bg-white"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">End Date</span>
          <input
            id="win-loss-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f] focus:bg-white"
          />
        </label>
        <div className="flex items-center gap-1.5 pb-px">
          {QUICK_RANGES.map((range) => {
            const active = startDate === formatDateInput(range.start()) && endDate === today
            return (
              <button
                key={range.label}
                type="button"
                onClick={() => selectQuickRange(range.start)}
                className={cn(
                  'h-9 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                  active
                    ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                    : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:border-[#c7c7d1]',
                )}
              >
                {range.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Loading */}
      {isLoading && <LoadingSkeleton />}

      {/* Error */}
      {error && !isLoading && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Failed to load win/loss report'}
          onRetry={() => analysisQuery.refetch()}
        />
      )}

      {/* Empty */}
      {!isLoading && !error && analysisQuery.data && analysisQuery.data.totalClosed === 0 && (
        <EmptyState
          title="No closed deals in range"
          description="No won or lost deals were closed in the selected date range."
        />
      )}

      {/* Data */}
      {!isLoading && !error && analysisQuery.data && analysisQuery.data.totalClosed > 0 && (
        <>
          <WinLossSummary
            wonCount={analysisQuery.data.wonCount}
            lostCount={analysisQuery.data.lostCount}
            winRate={analysisQuery.data.winRate}
            wonValue={analysisQuery.data.wonValue}
            lostValue={analysisQuery.data.lostValue}
            currency={analysisQuery.data.currency}
          />
          <div className="grid grid-cols-1 items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
            <LossReasonsChart
              winReasons={analysisQuery.data.winReasons}
              lossReasons={analysisQuery.data.lossReasons}
              currency={analysisQuery.data.currency}
            />
            <CompetitorComparisonTable
              competitors={analysisQuery.data.competitors}
              currency={analysisQuery.data.currency}
            />
          </div>
        </>
      )}
    </div>
  )
}
