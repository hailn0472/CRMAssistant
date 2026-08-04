'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchTimeline } from '@/services/activity.service'

type DealTimelineProps = {
  dealId: string
  contactId?: string | null
}

export type TimelineEntry = {
  id?: string
  title: string
  meta: string
  dot: string
  auto: boolean
}

const DEFAULT_TIMELINE_ENTRIES: TimelineEntry[] = [
  {
    id: '1',
    title: 'Deal marked Closed lost',
    meta: 'Acme Admin · 3 Aug 2026, 12:40',
    dot: '#b91c1c',
    auto: false,
  },
  {
    id: '2',
    title: 'Loss reason set to Budget cut',
    meta: 'Acme Admin · 3 Aug 2026, 12:39',
    dot: '#8c8c96',
    auto: false,
  },
  {
    id: '3',
    title: 'Stage changed Proposal → Negotiation',
    meta: 'System · 28 Jul 2026, 09:02',
    dot: '#4f46e5',
    auto: true,
  },
  {
    id: '4',
    title: 'Proposal sent to Suppressed Flow',
    meta: 'Acme Sales Rep · 22 Jul 2026, 16:15',
    dot: '#c2860a',
    auto: true,
  },
]

export function DealTimeline({ dealId, contactId }: DealTimelineProps): React.JSX.Element {
  const { data: activityResult, isLoading } = useQuery({
    queryKey: ['dealTimeline', contactId ?? dealId],
    queryFn: () => (contactId ? fetchTimeline(contactId, 20) : Promise.resolve(null)),
    enabled: Boolean(contactId),
  })

  let entries: TimelineEntry[] = DEFAULT_TIMELINE_ENTRIES

  if (activityResult && activityResult.edges.length > 0) {
    entries = activityResult.edges.map(({ node }) => {
      const isAuto = Boolean(node.source)
      const isLost = node.type.includes('LOST') || node.title.toLowerCase().includes('closed lost')
      const dotColor = isLost ? '#b91c1c' : isAuto ? '#4f46e5' : '#8c8c96'
      const formattedDate = new Date(node.createdAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      return {
        id: node.id,
        title: node.title,
        meta: `${node.createdBy || 'System'} · ${formattedDate}`,
        dot: dotColor,
        auto: isAuto,
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-[18px]">
        <div className="h-4 w-48 animate-pulse rounded bg-[#f2f2f5]" />
        <div className="h-4 w-64 animate-pulse rounded bg-[#f2f2f5]" />
      </div>
    )
  }

  return (
    <div className="flex flex-col px-[18px] pb-1.5 pt-4">
      {entries.map((e, index) => (
        <div key={e.id ?? index} className="flex gap-3 pb-4">
          <div className="flex flex-none flex-col items-center gap-1 pt-1">
            <span
              className="block h-[8px] w-[8px] flex-none rounded-full"
              style={{ backgroundColor: e.dot }}
            />
            {index < entries.length - 1 && <span className="block w-px flex-1 bg-[#ececf0]" />}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-[#1b1b1f]">{e.title}</span>
              {e.auto && (
                <span className="rounded-[5px] bg-[#f4f4f6] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#6b6b76]">
                  Auto
                </span>
              )}
            </div>
            <span className="text-[12px] text-[#8c8c96]">{e.meta}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
