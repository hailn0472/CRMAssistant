/**
 * Story 6.8 — Activity Reports thin route page.
 */
import { ActivityReportsPage } from '@/components/reports/ActivityReportsPage'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function Page(): React.JSX.Element {
  return (
    <QueryProvider>
      <ActivityReportsPage />
    </QueryProvider>
  )
}
