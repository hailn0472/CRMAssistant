import Link from 'next/link'
import { Plus } from 'lucide-react'

import { DealsTable } from '@/components/deals/DealsTable'
import { DealMetricsCards } from '@/components/deals/DealMetricsCards'
import { QueryProvider } from '@/components/contacts/QueryProvider'

const secondaryLinkClass =
  'inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50'

export default function DealsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-[28px] font-bold tracking-tight text-slate-900">Deals</h1>
            <p className="text-[13.5px] text-slate-500">
              Track and manage sales opportunities moving through your pipeline.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/deals/competitors" className={secondaryLinkClass}>
              Competitors
            </Link>
            <Link href="/deals/products" className={secondaryLinkClass}>
              Products
            </Link>
            <Link href="/deals/pipeline" className={secondaryLinkClass}>
              Pipeline view
            </Link>
            <Link
              href="/deals/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black"
            >
              <Plus className="h-3.5 w-3.5" />
              Create deal
            </Link>
          </div>
        </div>

        {/* KPI Metrics Summary Cards */}
        <DealMetricsCards />

        <DealsTable />
      </div>
    </QueryProvider>
  )
}
