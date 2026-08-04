'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getContactStats } from '@/services/contact.service'
import { MetricsCards } from '@/components/shared/MetricsCards'

export function ContactMetricsCards(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['contacts-stats'],
    queryFn: () => getContactStats(),
  })

  const metrics = useMemo(
    () => [
      { label: 'Total contacts', value: (data?.total ?? 0).toLocaleString() },
      { label: 'Added this month', value: (data?.addedThisMonth ?? 0).toLocaleString() },
      { label: 'With open deals', value: (data?.withOpenDeals ?? 0).toLocaleString() },
      { label: 'Unassigned', value: (data?.unassigned ?? 0).toLocaleString() },
    ],
    [data],
  )

  return <MetricsCards metrics={metrics} isLoading={isLoading} />
}
