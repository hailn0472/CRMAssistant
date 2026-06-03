import { AppShell } from '@/components/layout/AppShell'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <AppShell>{children}</AppShell>
}
