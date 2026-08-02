'use client'

import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function TopbarActions(): React.JSX.Element {
  return (
    <>
      <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50/80 px-3 py-1 text-[12px] font-medium text-slate-600">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        All systems normal
      </div>

      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="View notifications"
        className="h-11 w-11 rounded-full border-slate-200 bg-white text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-indigo-600/40"
      >
        <Bell className="h-4 w-4" />
      </Button>
    </>
  )
}
