'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getSalesForecast, getForecastAccuracy } from '@/services/forecast.service'
import { getUsers } from '@/services/user.service'
import { getTeams } from '@/services/team.service'
import { ForecastChart } from './ForecastChart'
import { ForecastBands } from './ForecastBands'
import { ForecastAccuracyTable } from './ForecastAccuracyTable'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { ErrorState } from '@/components/shared/ErrorState'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { ON_DEAL_UPDATED_SUBSCRIPTION } from '@/services/deal.service'
import type { ForecastGroupBy, SalesForecastFilter } from '@/services/forecast.service'

const DEFAULT_START = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  .toISOString()
  .slice(0, 10)
const DEFAULT_END = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 5, 0))
  .toISOString()
  .slice(0, 10)

export function ForecastReport(): React.JSX.Element {
  const queryClient = useQueryClient()
  const clientRef = useRef<GraphqlSubscriptionClient | null>(null)
  const connectGuardRef = useRef(false)

  // Filters
  const [startDate, setStartDate] = useState(DEFAULT_START)
  const [endDate, setEndDate] = useState(DEFAULT_END)
  const [groupBy, setGroupBy] = useState<ForecastGroupBy>('MONTH')
  const [ownerId, setOwnerId] = useState<string>('')
  const [teamId, setTeamId] = useState<string>('')

  const filter: SalesForecastFilter = {
    startDate,
    endDate,
    groupBy,
    ...(ownerId ? { ownerId } : {}),
    ...(teamId ? { teamId } : {}),
  }

  // Queries
  const salesQuery = useQuery({
    queryKey: ['forecast', 'sales', filter],
    queryFn: () => getSalesForecast(filter),
  })

  const accuracyQuery = useQuery({
    queryKey: ['forecast', 'accuracy', startDate, endDate],
    queryFn: () => getForecastAccuracy(startDate, endDate),
  })

  // Users and teams for filter selects
  const usersQuery = useQuery({
    queryKey: ['users', 1, 100],
    queryFn: () => getUsers(1, 100),
  })

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => getTeams(),
  })

  // Real-time subscription
  const handleDealUpdate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['forecast'] })
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

  const isLoading = salesQuery.isLoading || accuracyQuery.isLoading
  const error = salesQuery.error || accuracyQuery.error

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <Card>
        <CardHeader>
          <CardTitle>Sales Forecast Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="start-date">
                Start Date
              </label>
              <input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="end-date">
                End Date
              </label>
              <input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="group-by">
                Group By
              </label>
              <select
                id="group-by"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as ForecastGroupBy)}
                className="flex h-10 w-36 rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              >
                <option value="MONTH">Month</option>
                <option value="QUARTER">Quarter</option>
                <option value="OWNER">Owner</option>
                <option value="TEAM">Team</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="owner">
                Owner
              </label>
              <select
                id="owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="flex h-10 w-44 rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              >
                <option value="">All Owners</option>
                {(usersQuery.data?.items ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="team">
                Team
              </label>
              <select
                id="team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="flex h-10 w-44 rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              >
                <option value="">All Teams</option>
                {(teamsQuery.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Weighted = deal value × probability. Amounts are summed without currency conversion.
          </p>
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && <LoadingSkeleton />}

      {/* Error */}
      {error && !isLoading && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Failed to load forecast'}
          onRetry={() => {
            salesQuery.refetch()
            accuracyQuery.refetch()
          }}
        />
      )}

      {/* Empty */}
      {!isLoading && !error && salesQuery.data && salesQuery.data.buckets.length === 0 && (
        <EmptyState
          title="No forecast data"
          description="No deals found in the selected date range."
        />
      )}

      {/* Data */}
      {!isLoading && !error && salesQuery.data && salesQuery.data.buckets.length > 0 && (
        <>
          <ForecastChart
            buckets={salesQuery.data.buckets}
            groupBy={groupBy}
            currency={salesQuery.data.currency}
          />
          <ForecastBands
            commit={salesQuery.data.commit}
            bestCase={salesQuery.data.bestCase}
            pipeline={salesQuery.data.pipeline}
            currency={salesQuery.data.currency}
          />
          {accuracyQuery.data && accuracyQuery.data.length > 0 && (
            <ForecastAccuracyTable
              periods={accuracyQuery.data}
              currency={salesQuery.data.currency}
            />
          )}
        </>
      )}
    </div>
  )
}
