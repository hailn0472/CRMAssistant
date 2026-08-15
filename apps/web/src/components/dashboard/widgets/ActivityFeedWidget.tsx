'use client'

import { Clock } from 'lucide-react'
import Link from 'next/link'
import type { WidgetResultData } from '@/services/dashboard.service'

export function ActivityFeedWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { rows } = data
  if (!rows.length) return <p className="text-sm text-slate-500">No recent activity</p>

  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => (
        <div key={row.id} className="flex items-start gap-2 py-2">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-700">{row.primaryLabel}</p>
            {row.secondaryLabel && <p className="text-xs text-slate-500">{row.secondaryLabel}</p>}
          </div>
          {row.href && (
            <Link
              href={row.href}
              className="shrink-0 text-xs text-indigo-600 hover:text-indigo-800"
            >
              View
            </Link>
          )}
        </div>
      ))}
    </div>
  )
}
