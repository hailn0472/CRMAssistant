import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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

interface WorkspacePanelProps {
  children: React.ReactNode
  className?: string
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

export function WorkspacePanel({ children, className }: WorkspacePanelProps): React.JSX.Element {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white', className)}>
      {children}
    </section>
  )
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
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
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white" role="banner">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <MobileNavigation />

            <Button
              type="button"
              variant="outline"
              aria-label="Search or run command"
              className="h-11 flex-1 justify-start border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 sm:max-w-md"
            >
              <span aria-hidden="true" className="text-sm">
                /
              </span>
              <span>Search or run command</span>
              <kbd className="ml-auto hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-400 sm:inline-flex">
                Ctrl K
              </kbd>
            </Button>

            <Button type="button" variant="ghost" size="icon" aria-label="View notifications">
              <span aria-hidden="true" className="text-sm font-semibold">
                N
              </span>
            </Button>

            <div
              aria-label="Current tenant and user"
              className="hidden min-h-11 items-center rounded-md border border-slate-200 bg-white px-3 text-sm sm:flex"
            >
              <div className="text-right">
                <p className="font-medium text-slate-950">Workspace</p>
                <p className="text-xs text-slate-500">Signed in</p>
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
