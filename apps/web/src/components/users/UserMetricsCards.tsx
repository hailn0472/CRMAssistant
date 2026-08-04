'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getUserStats } from '@/services/user.service'

export function UserMetricsCards(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['users-stats'],
    queryFn: () => getUserStats(),
  })

  const metrics = useMemo(
    () => [
      { label: 'Total users', value: data?.total ?? 0 },
      { label: 'Active', value: data?.active ?? 0 },
      { label: 'Deactivated', value: data?.deactivated ?? 0 },
      { label: 'Admins', value: data?.admins ?? 0 },
    ],
    [data],
  )

  if (isLoading) {
    return (
      <div className="grid animate-pulse grid-cols-1 gap-px overflow-hidden rounded-[12px] border border-[#ececf0] bg-[#ececf0] sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex h-[76px] flex-col justify-between bg-white px-[18px] py-4">
            <div className="h-3 w-24 rounded bg-[#f0f0f3]" />
            <div className="mt-2 h-6 w-14 rounded bg-[#ececf0]" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[12px] border border-[#ececf0] bg-[#ececf0] sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((item) => (
        <div key={item.label} className="flex flex-col gap-1.5 bg-white px-[18px] py-4">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">{item.label}</span>
          <span className="text-[21px] font-semibold tracking-[-0.02em] text-[#1b1b1f]">
            {item.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}
