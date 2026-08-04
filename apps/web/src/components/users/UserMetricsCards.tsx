'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getUserStats } from '@/services/user.service'
import { MetricsCards } from '@/components/shared/MetricsCards'

export function UserMetricsCards(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['users-stats'],
    queryFn: () => getUserStats(),
  })

  const metrics = useMemo(
    () => [
      { label: 'Total users', value: (data?.total ?? 0).toLocaleString() },
      { label: 'Active', value: (data?.active ?? 0).toLocaleString() },
      { label: 'Deactivated', value: (data?.deactivated ?? 0).toLocaleString() },
      { label: 'Admins', value: (data?.admins ?? 0).toLocaleString() },
    ],
    [data],
  )

  return <MetricsCards metrics={metrics} isLoading={isLoading} />
}
