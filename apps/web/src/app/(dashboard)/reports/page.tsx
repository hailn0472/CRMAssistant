import { redirect } from 'next/navigation'

// Story 6.2 (AC 64): the primary Reports entry redirects to the sales
// reports workspace.
export default function ReportsPage(): never {
  redirect('/reports/sales')
}
