import { Suspense } from 'react'

import { NotificationsWorkspace } from '@/components/notifications/NotificationsWorkspace'

/**
 * Story 4.8 (AC 68): THIN route — every line of logic lives in
 * NotificationsWorkspace. App-router page files are excluded from web
 * coverage, so anything placed here is untested by definition.
 */
export default function NotificationsPage(): React.JSX.Element {
  return (
    <Suspense>
      <NotificationsWorkspace />
    </Suspense>
  )
}
