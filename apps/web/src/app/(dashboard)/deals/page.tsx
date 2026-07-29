import { DealsTable } from '@/components/deals/DealsTable'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function DealsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <DealsTable />
    </QueryProvider>
  )
}
