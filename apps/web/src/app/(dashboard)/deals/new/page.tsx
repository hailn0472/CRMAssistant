import { DealForm } from '@/components/deals/DealForm'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function NewDealPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <div className="space-y-6 p-6 text-slate-950">
        <DealForm />
      </div>
    </QueryProvider>
  )
}
