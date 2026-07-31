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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { ON_DEAL_UPDATED_SUBSCRIPTION } from '@/services/deal.service'
import { formatDateInput, startOfCurrentQuarterUtc, todayUtc } from '@/lib/win-loss-format'

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

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <Card>
        <CardHeader>
          <CardTitle>Win/Loss Report Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="win-loss-start">
                Start Date
              </label>
              <input
                id="win-loss-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="win-loss-end">
                End Date
              </label>
              <input
                id="win-loss-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Closed deals are counted by their actual close date. Amounts are summed without currency
            conversion.
          </p>
        </CardContent>
      </Card>

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
          <LossReasonsChart
            winReasons={analysisQuery.data.winReasons}
            lossReasons={analysisQuery.data.lossReasons}
            currency={analysisQuery.data.currency}
          />
          <CompetitorComparisonTable
            competitors={analysisQuery.data.competitors}
            currency={analysisQuery.data.currency}
          />
        </>
      )}
    </div>
  )
}
