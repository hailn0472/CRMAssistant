'use client'

import { Circle } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { WidgetResultData } from '@/services/dashboard.service'

const BADGE_VARIANT_MAP: Record<string, 'neutral' | 'warning' | 'danger' | 'success'> = {
  NEUTRAL: 'neutral',
  WARNING: 'warning',
  DANGER: 'danger',
  SUCCESS: 'success',
}

export function TaskListWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { rows } = data
  if (!rows.length) return <p className="text-sm text-slate-500">No tasks</p>

  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => {
        const content = (
          <div key={row.id} className="flex items-center gap-2 py-2">
            <Circle className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-700">{row.primaryLabel}</p>
              {row.secondaryLabel && (
                <p className="truncate text-xs text-slate-500">{row.secondaryLabel}</p>
              )}
            </div>
            {row.badgeLabel && (
              <Badge
                variant={BADGE_VARIANT_MAP[row.badgeTone ?? 'NEUTRAL'] ?? 'neutral'}
                className="text-[11px]"
              >
                {row.badgeLabel}
              </Badge>
            )}
          </div>
        )
        if (row.href) {
          return (
            <Link key={row.id} href={row.href} className="block hover:bg-slate-50">
              {content}
            </Link>
          )
        }
        return content
      })}
    </div>
  )
}
