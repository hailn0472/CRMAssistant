'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { CommandDialog } from './CommandDialog'
import { DesktopNavigation, MobileNavigation } from './AppShellNavigation'

interface AppShellProps {
  children: React.ReactNode
}

interface WorkspaceHeaderProps {
  eyebrow: string
  title: string
  description?: string
  actions?: React.ReactNode
}

interface WorkspacePanelProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
}

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  actions,
}: WorkspaceHeaderProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function WorkspacePanel({
  children,
  className,
  ...props
}: WorkspacePanelProps): React.JSX.Element {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white', className)} {...props}>
      {children}
    </section>
  )
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-950">CRMAssistant</p>
            <p className="text-xs text-slate-500">Calm CRM workspace</p>
          </div>
        </div>
        <DesktopNavigation />
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95" role="banner">
          <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center">
              <MobileNavigation />
            </div>

            <div className="relative w-[min(38rem,calc(100vw-9rem))]">
              <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-slate-500 shadow-none focus-within:border-blue-200 focus-within:ring-2 focus-within:ring-blue-100">
                <span aria-hidden="true" className="mr-2 text-slate-400">
                  /
                </span>
                <input
                  type="search"
                  aria-label="Search or run command"
                  aria-haspopup="dialog"
                  value={commandQuery}
                  onChange={(event) => {
                    setCommandQuery(event.target.value)
                    setCommandOpen(true)
                  }}
                  onFocus={(event) => {
                    if ('dataset' in event.target) {
                      const input = event.target as HTMLInputElement
                      if (input.dataset.returningFocus !== undefined) {
                        delete input.dataset.returningFocus
                        return
                      }
                    }
                    setCommandOpen(true)
                  }}
                  placeholder="Search or run command"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
                />
                <kbd className="ml-2 hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 sm:inline-flex">
                  Ctrl K
                </kbd>
              </div>
              <CommandDialog
                open={commandOpen}
                query={commandQuery}
                onOpenChange={setCommandOpen}
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="View notifications"
                className="h-10 w-10 rounded-lg border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-950"
              >
                <span aria-hidden="true" className="text-sm font-medium">
                  !
                </span>
              </Button>

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
            </div>
          </div>
        </header>

        <main aria-label="CRM workspace" className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
