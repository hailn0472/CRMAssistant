import { SalesReportsWorkspace } from '@/components/reports/SalesReportsWorkspace'

// Story 6.2 (AC 64): thin page — the (dashboard)/layout.tsx QueryProvider is
// already in place; do NOT wrap this page in another QueryProvider.
export default function SalesReportsPage(): React.JSX.Element {
  return <SalesReportsWorkspace />
}
