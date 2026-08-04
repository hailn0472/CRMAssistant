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
      <div className="grid animate-pulse grid-cols-1 gap-[1px] overflow-hidden rounded-[12px] border border-[#ececf0] bg-[#ececf0] sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex h-[76px] flex-col justify-between bg-white px-[18px] py-[16px]"
          >
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="mt-2 h-6 w-16 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-[1px] overflow-hidden rounded-[12px] border border-[#ececf0] bg-[#ececf0] sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((item) => (
        <div key={item.label} className="flex flex-col gap-[6px] bg-white px-[18px] py-[16px]">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">{item.label}</span>
          <span className="text-[21px] font-semibold tracking-[-0.02em] text-[#1b1b1f]">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}
