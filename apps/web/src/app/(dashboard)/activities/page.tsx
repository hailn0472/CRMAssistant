import { Suspense } from 'react'

import { ActivitiesWorkspace } from '@/components/activities/ActivitiesWorkspace'

/**
 * Story 4.4 (AC 20): THIN route — every line of logic lives in
 * ActivitiesWorkspace. App-router page files are excluded from web coverage,
 * so anything placed here is untested by definition. useSearchParams requires
 * the Suspense boundary (house pattern, e.g. login/page.tsx).
 */
export default function ActivitiesPage(): React.JSX.Element {
  return (
    <Suspense>
      <ActivitiesWorkspace />
    </Suspense>
  )
}
