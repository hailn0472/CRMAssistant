'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDeals } from '@/services/deal.service'
import { MetricsCards } from '@/components/shared/MetricsCards'

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
        wonThisQuarterSum += val
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

  return <MetricsCards metrics={metrics} isLoading={isLoading} />
}
