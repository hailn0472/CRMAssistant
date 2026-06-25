'use client'

import { useEffect } from 'react'

import { ErrorState } from '@/components/shared/ErrorState'

interface AuthErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AuthError({ error, reset }: AuthErrorProps): React.JSX.Element {
  useEffect(() => {
    console.error('Auth error boundary caught:', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <ErrorState
          message={
            error.message
              ? `Something went wrong during authentication: ${error.message}`
              : 'Something went wrong during authentication. Please try again.'
          }
          onRetry={reset}
        />
      </div>
    </div>
  )
}
