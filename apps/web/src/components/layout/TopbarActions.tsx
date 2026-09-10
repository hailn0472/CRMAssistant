'use client'

import { NotificationBell } from '@/components/notifications/NotificationBell'

export function TopbarActions(): React.JSX.Element {
  return (
    <>
      <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50/80 px-3 py-1 text-[12px] font-medium text-slate-600">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        All systems normal
      </div>

      <NotificationBell />
    </>
  )
}
