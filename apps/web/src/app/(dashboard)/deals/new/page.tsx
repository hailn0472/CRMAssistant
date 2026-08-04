import { DealFormPanel } from '@/components/deals/DealFormPanel'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function NewDealPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <DealFormPanel />
    </QueryProvider>
  )
}
