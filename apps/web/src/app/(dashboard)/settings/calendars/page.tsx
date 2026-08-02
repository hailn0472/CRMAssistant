'use client'

import { QueryProvider } from '@/components/contacts/QueryProvider'
import { CalendarConnectionsPanel } from '@/components/settings/CalendarConnectionsPanel'

// Thin page — app/**/page.tsx is excluded from web coverage; keep logic in
// the component (AC 40).
export default function CalendarsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <CalendarConnectionsPanel />
    </QueryProvider>
  )
}
