import type { ReactNode } from 'react'

import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  actions?: ReactNode
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  actions,
}: ErrorStateProps): React.JSX.Element {
  const safeMessage = message.trim() || 'An unexpected error occurred. Please try again.'

  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 border-l-4 border-l-red-500 bg-white p-6 shadow-sm"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{safeMessage}</p>
          {onRetry ?? actions ? (
            <div className="mt-4 flex flex-wrap gap-3">
              {onRetry ? (
                <Button onClick={onRetry} type="button" variant="outline">
                  Try again
                </Button>
              ) : null}
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
