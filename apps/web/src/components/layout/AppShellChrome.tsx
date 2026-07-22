import { cn } from '@/lib/utils'
import { Breadcrumbs } from './Breadcrumbs'

interface AppShellChromeProps {
  sidebarSlot: React.ReactNode
  tabletRailSlot: React.ReactNode
  mobileNavSlot: React.ReactNode
  searchSlot: React.ReactNode
  topbarActionsSlot: React.ReactNode
  children: React.ReactNode
}

interface WorkspaceHeaderProps {
  eyebrow: string
  title: string
  description?: string
  actions?: React.ReactNode
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

interface WorkspacePanelProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
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

export function AppShellChrome({
  sidebarSlot,
  tabletRailSlot,
  mobileNavSlot,
  searchSlot,
  topbarActionsSlot,
  children,
}: AppShellChromeProps): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      {/* Tablet icon rail (md: 768-1023px) */}
      <aside
        aria-label="Tablet CRM navigation"
        className="fixed inset-y-0 left-0 hidden w-[56px] border-r border-slate-200 bg-white md:flex md:flex-col lg:hidden"
      >
        <div className="flex h-16 items-center justify-center border-b border-slate-200">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-950 text-[9px] font-semibold text-white">
            CRM
          </div>
        </div>
        {tabletRailSlot}
      </aside>

      {/* Desktop sidebar (lg: >=1024px) */}
      <aside
        aria-label="Desktop CRM navigation"
        className="fixed inset-y-0 left-0 hidden w-60 border-r border-slate-200 bg-white lg:flex lg:flex-col"
      >
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-950">CRMAssistant</p>
            <p className="text-xs text-slate-500">Calm CRM workspace</p>
          </div>
        </div>
        {sidebarSlot}
      </aside>

      {/* Main content area */}
      <div className="md:pl-[56px] lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95" role="banner">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              {mobileNavSlot}
              <Breadcrumbs className="hidden lg:flex" />
            </div>
            <div className="flex flex-1 items-center justify-center min-w-0">{searchSlot}</div>
            <div className="flex items-center justify-end gap-2 shrink-0">{topbarActionsSlot}</div>
          </div>
        </header>

        <main aria-label="CRM workspace" className="p-4 lg:p-5">
          <div className="w-full space-y-5">{children}</div>
        </main>
      </div>
    </div>
  )
}
