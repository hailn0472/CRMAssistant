'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getTaskStats } from '@/services/task.service'
import { MetricsCards } from '@/components/shared/MetricsCards'

export function TaskMetricsCards(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['tasks-stats'],
    queryFn: () => getTaskStats(),
  })

  const metrics = useMemo(
    () => [
      { label: 'Open tasks', value: (data?.openTasks ?? 0).toLocaleString() },
      { label: 'Due today', value: (data?.dueToday ?? 0).toLocaleString() },
      { label: 'Overdue', value: (data?.overdue ?? 0).toLocaleString() },
      { label: 'Completed this week', value: (data?.completedThisWeek ?? 0).toLocaleString() },
    ],
    [data],
  )

  return <MetricsCards metrics={metrics} isLoading={isLoading} variant="divide" />
}
