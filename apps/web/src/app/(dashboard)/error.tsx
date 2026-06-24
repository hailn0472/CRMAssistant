'use client'

import { useEffect } from 'react'

import { ErrorState } from '@/components/shared/ErrorState'
import { WorkspacePanel } from '@/components/layout/AppShell'

interface DashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: DashboardErrorProps): React.JSX.Element {
  useEffect(() => {
    // TODO: replace with Sentry.captureException(error) when Sentry is integrated
    console.error('Dashboard error boundary caught:', error)
  }, [error])

  return (
    <div className="flex items-start justify-center px-4 py-16">
      <WorkspacePanel className="w-full max-w-xl p-6">
        <ErrorState
          message={
            error.message
              ? `Something unexpected happened: ${error.message}`
              : 'Something unexpected happened while loading this page.'
          }
          onRetry={reset}
        />
      </WorkspacePanel>
    </div>
  )
}
