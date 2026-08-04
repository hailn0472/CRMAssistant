import { DealsWorkspace } from '@/components/deals/DealsWorkspace'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function DealsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <DealsWorkspace />
    </QueryProvider>
  )
}
