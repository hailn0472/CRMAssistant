'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getContactStats } from '@/services/contact.service'

export function ContactMetricsCards(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['contacts-stats'],
    queryFn: () => getContactStats(),
  })

  const metrics = useMemo(
    () => [
      { label: 'Total contacts', value: data?.total ?? 0 },
      { label: 'Added this month', value: data?.addedThisMonth ?? 0 },
      { label: 'With open deals', value: data?.withOpenDeals ?? 0 },
      { label: 'Unassigned', value: data?.unassigned ?? 0 },
    ],
    [data],
  )

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
            {item.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}
