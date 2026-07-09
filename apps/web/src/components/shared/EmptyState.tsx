import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          {icon}
        </div>
      ) : null}
      <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
