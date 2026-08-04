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
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { ON_DEAL_UPDATED_SUBSCRIPTION } from '@/services/deal.service'
import { salesForecastToCsv } from '@/lib/forecast-format'
import type { ForecastGroupBy, SalesForecastFilter } from '@/services/forecast.service'

const DEFAULT_START = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  .toISOString()
  .slice(0, 10)
const DEFAULT_END = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 5, 0))
  .toISOString()
  .slice(0, 10)

const fieldClass =
  'h-9 rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f] focus:bg-white'

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

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

  function handleExport(): void {
    if (!salesQuery.data) return
    const csv = salesForecastToCsv(salesQuery.data)
    downloadCsv(csv, `sales-forecast-${startDate}-to-${endDate}.csv`)
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-[22px]">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
            Sales forecast
          </h1>
          <p className="max-w-[56ch] text-[13.5px] text-[#77777f]">
            Weighted value = deal value × probability. Amounts are summed without currency
            conversion.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!salesQuery.data}
          className="inline-flex h-9 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:pointer-events-none disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <section
        aria-label="Sales Forecast Filters"
        className="flex flex-wrap items-end gap-3.5 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Start Date</span>
          <input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">End Date</span>
          <input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Group By</span>
          <select
            id="group-by"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as ForecastGroupBy)}
            className={`${fieldClass} cursor-pointer`}
          >
            <option value="MONTH">Month</option>
            <option value="QUARTER">Quarter</option>
            <option value="OWNER">Owner</option>
            <option value="TEAM">Team</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Owner</span>
          <select
            id="owner"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className={`${fieldClass} min-w-[150px] cursor-pointer`}
          >
            <option value="">All owners</option>
            {(usersQuery.data?.items ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Team</span>
          <select
            id="team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className={`${fieldClass} min-w-[150px] cursor-pointer`}
          >
            <option value="">All teams</option>
            {(teamsQuery.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </section>

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
