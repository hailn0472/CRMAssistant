'use client'

import { Button } from '@/components/ui/button'

export function TopbarActions(): React.JSX.Element {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="View notifications"
        className="h-11 w-11 rounded-lg border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-950"
      >
        <span aria-hidden="true" className="text-sm font-medium">
          !
        </span>
      </Button>

      {/* Desktop tenant/user badge */}
      <div
        aria-label="Current tenant and user"
        className="hidden h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm lg:flex"
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-950 text-[10px] font-semibold text-white"
        >
          W
        </span>
        <div className="leading-tight">
          <p className="text-sm font-medium text-slate-950">Workspace</p>
          <p className="text-[11px] text-slate-500">Signed in</p>
        </div>
      </div>

      {/* Mobile/tablet compact user badge (visible below lg) */}
      <div
        aria-label="Current tenant and user"
        className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 text-sm lg:hidden"
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-950 text-[10px] font-semibold text-white"
        >
          W
        </span>
      </div>
    </>
  )
}
