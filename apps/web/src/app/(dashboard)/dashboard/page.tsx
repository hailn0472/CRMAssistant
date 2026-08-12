import { Suspense } from 'react'

import { DashboardSkeleton } from '@/components/shared/LoadingSkeleton'
import { DashboardWorkspace } from '@/components/dashboard/DashboardWorkspace'

/**
 * Thin page component — Suspense boundary required for useSearchParams()
 * in DashboardWorkspace (Trap T30).
 */
export default function DashboardPage(): React.JSX.Element {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardWorkspace />
    </Suspense>
  )
}
