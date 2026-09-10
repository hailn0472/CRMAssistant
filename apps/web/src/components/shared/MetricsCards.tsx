'use client'

import { cn } from '@/lib/utils'

export type MetricsCardItem = {
  label: string
  value: string
}

type MetricsCardsProps = {
  metrics: MetricsCardItem[]
  isLoading: boolean
  /** `hairline` (default) renders 1px gray hairlines between white cells; `divide` renders a bordered divider grid on a plain white background. */
  variant?: 'hairline' | 'divide'
}

const VARIANT_STYLES = {
  hairline: {
    grid: 'grid grid-cols-1 gap-[1px] overflow-hidden rounded-[12px] border border-[#ececf0] bg-[#ececf0] sm:grid-cols-2 lg:grid-cols-4',
    cell: 'flex flex-col gap-[6px] bg-white px-[18px] py-[16px]',
    skeletonCell: 'flex h-[76px] flex-col justify-between bg-white px-[18px] py-[16px]',
  },
  divide: {
    grid: 'grid grid-cols-1 divide-y divide-[#ececf0] rounded-[12px] border border-[#ececf0] bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4',
    cell: 'flex flex-col gap-1.5 p-[18px]',
    skeletonCell: 'flex h-[88px] flex-col justify-between p-[18px]',
  },
} as const

export function MetricsCards({
  metrics,
  isLoading,
  variant = 'hairline',
}: MetricsCardsProps): React.JSX.Element {
  const styles = VARIANT_STYLES[variant]

  if (isLoading) {
    return (
      <div className={cn('animate-pulse', styles.grid)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.skeletonCell}>
            <div className="h-3 w-24 rounded bg-[#f0f0f3]" />
            <div className="mt-2 h-6 w-16 rounded bg-[#ececf0]" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {metrics.map((item) => (
        <div key={item.label} className={styles.cell}>
          <span className="text-[11.5px] font-medium text-[#8c8c96]">{item.label}</span>
          <span className="text-[21px] font-semibold tracking-[-0.02em] text-[#1b1b1f]">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}
