import { AppShell } from '@/components/layout/AppShell'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <QueryProvider>
      <AppShell>{children}</AppShell>
    </QueryProvider>
  )
}
