import { DealsTable } from '@/components/deals/DealsTable'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import Link from 'next/link'

export default function DealsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <div className="mb-4 flex items-center justify-between">
        <div />
        <div className="flex items-center gap-2">
          <Link
            href="/deals/competitors"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Competitors
          </Link>
          <Link
            href="/deals/products"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Products
          </Link>
          <Link
            href="/deals/pipeline"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Pipeline View
          </Link>
        </div>
      </div>
      <DealsTable />
    </QueryProvider>
  )
}
