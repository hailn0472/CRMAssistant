import type { ReactNode } from 'react'

import { ShieldAlert } from 'lucide-react'

interface PermissionLimitedStateProps {
  title?: string
  message: string
  requiredPermission?: string
  actions?: ReactNode
}

const PERMISSION_LABELS: Record<string, string> = {
  'contacts:read': 'View contacts',
  'contacts:write': 'Edit contacts',
  'contacts:delete': 'Delete contacts',
  'deals:read': 'View deals',
  'deals:write': 'Edit deals',
  admin: 'Administrator access',
}

export function PermissionLimitedState({
  title = 'Access limited',
  message,
  requiredPermission,
  actions,
}: PermissionLimitedStateProps): React.JSX.Element {
  const permissionLabel = requiredPermission
    ? PERMISSION_LABELS[requiredPermission] ?? 'Additional access'
    : undefined

  return (
    <div className="rounded-xl border border-amber-200 border-l-4 border-l-amber-500 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{message}</p>
          {permissionLabel ? (
            <p className="mt-2 text-xs text-slate-500">
              Required access: <span className="font-medium text-slate-700">{permissionLabel}</span>
            </p>
          ) : null}
          {actions ? <div className="mt-4 flex flex-wrap gap-3">{actions}</div> : null}
        </div>
      </div>
    </div>
  )
}
