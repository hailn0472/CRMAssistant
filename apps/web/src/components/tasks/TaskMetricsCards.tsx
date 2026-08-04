'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getTaskStats } from '@/services/task.service'

export function TaskMetricsCards(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['tasks-stats'],
    queryFn: () => getTaskStats(),
  })

  const metrics = useMemo(
    () => [
      { label: 'Open tasks', value: data?.openTasks ?? 0 },
      { label: 'Due today', value: data?.dueToday ?? 0 },
      { label: 'Overdue', value: data?.overdue ?? 0 },
      { label: 'Completed this week', value: data?.completedThisWeek ?? 0 },
    ],
    [data],
  )

  if (isLoading) {
    return (
      <div className="grid animate-pulse grid-cols-1 divide-y divide-[#ececf0] rounded-[12px] border border-[#ececf0] bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex h-[88px] flex-col justify-between p-[18px]">
            <div className="h-3 w-24 rounded bg-[#f0f0f3]" />
            <div className="mt-2 h-6 w-14 rounded bg-[#ececf0]" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 divide-y divide-[#ececf0] rounded-[12px] border border-[#ececf0] bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
      {metrics.map((item) => (
        <div key={item.label} className="flex flex-col gap-1.5 p-[18px]">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">{item.label}</span>
          <span className="text-[21px] font-semibold tracking-[-0.02em] text-[#1b1b1f]">
            {item.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}
