import { PipelineBoard } from '@/components/deals/PipelineBoard'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import Link from 'next/link'

export default function PipelinePage(): React.JSX.Element {
  return (
    <QueryProvider>
      <div className="mb-4 flex items-center justify-between">
        <div />
        <Link
          href="/deals"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Table View
        </Link>
      </div>
      <PipelineBoard />
    </QueryProvider>
  )
}
