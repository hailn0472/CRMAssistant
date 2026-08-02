'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDeals } from '@/services/deal.service'

function formatMetricValue(value: number): string {
  if (!value || isNaN(value) || value === 0) return '$0'
  if (value >= 1_000_000) {
    const formatted = (value / 1_000_000).toFixed(2).replace(/\.00$/, '')
    return `$${formatted}M`
  }
  if (value >= 1_000) {
    const formatted = (value / 1_000).toFixed(1).replace(/\.0$/, '')
    return `$${formatted}K`
  }
  return `$${Math.round(value).toLocaleString()}`
}

export function DealMetricsCards(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['deals-metrics'],
    queryFn: () => getDeals(1, 1000),
  })

  const metrics = useMemo(() => {
    const deals = data?.items ?? []
    if (deals.length === 0) {
      return [
        { label: 'Open pipeline', value: '$0' },
        { label: 'Weighted forecast', value: '$0' },
        { label: 'Won this quarter', value: '$0' },
        { label: 'Avg. deal size', value: '$0' },
      ]
    }

    const now = new Date()
    const currentYear = now.getFullYear()
    const currentQuarter = Math.floor(now.getMonth() / 3)

    let openPipelineSum = 0
    let weightedForecastSum = 0
    let wonThisQuarterSum = 0
    let totalDealValueSum = 0
    const dealCount = deals.length

    for (const deal of deals) {
      const val = Number(deal.value) || 0
      totalDealValueSum += val

      const stageName = (deal.stage?.name ?? '').toLowerCase()
      const isWon = Boolean(deal.stage?.isWon || stageName.includes('won'))
      const isLost = Boolean(deal.stage?.isLost || stageName.includes('lost'))
      const isOpen = !isWon && !isLost

      if (isOpen) {
        openPipelineSum += val
        const prob = deal.probability ?? deal.stage?.probability ?? 50
        weightedForecastSum += val * (prob / 100)
      }

      if (isWon) {
        const closeDateStr = deal.actualCloseDate || deal.expectedCloseDate || deal.updatedAt
        if (closeDateStr) {
          const d = new Date(closeDateStr)
          if (
            !isNaN(d.getTime()) &&
            d.getFullYear() === currentYear &&
            Math.floor(d.getMonth() / 3) === currentQuarter
          ) {
            wonThisQuarterSum += val
          } else {
            wonThisQuarterSum += val
          }
        } else {
          wonThisQuarterSum += val
        }
      }
    }

    const avgDealSizeVal = dealCount > 0 ? totalDealValueSum / dealCount : 0

    return [
      { label: 'Open pipeline', value: formatMetricValue(openPipelineSum) },
      { label: 'Weighted forecast', value: formatMetricValue(weightedForecastSum) },
      { label: 'Won this quarter', value: formatMetricValue(wonThisQuarterSum) },
      { label: 'Avg. deal size', value: formatMetricValue(avgDealSizeVal) },
    ]
  }, [data])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-5 flex flex-col justify-between h-[88px]">
            <div className="h-3 w-24 bg-slate-100 rounded" />
            <div className="h-7 w-20 bg-slate-200 rounded mt-2" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
      {metrics.map((item) => (
        <div key={item.label} className="p-5 flex flex-col justify-between">
          <span className="text-[11.5px] font-medium text-slate-400 uppercase tracking-wider">
            {item.label}
          </span>
          <span className="text-[26px] font-bold tracking-tight text-slate-900 mt-1">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}
