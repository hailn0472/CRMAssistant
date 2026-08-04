'use client'

import Link from 'next/link'

import { DealForm } from '@/components/deals/DealForm'
import type { Deal } from '@/services/deal.service'

type DealFormPanelProps = {
  deal?: Deal
}

/// Route-level presentation of DealForm (/deals/new, /deals/[id]/edit).
/// The deals list opens the same form as a slide-over instead.
export function DealFormPanel({ deal }: DealFormPanelProps): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
          {deal ? 'Edit deal' : 'New deal'}
        </h1>
        <p className="text-[13.5px] text-[#77777f]">
          {deal
            ? `Update details for ${deal.title}.`
            : 'Fill in the deal details and assign a primary contact.'}
        </p>
      </div>

      <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
        <DealForm deal={deal} />
      </div>

      <Link
        href={deal ? `/deals/${deal.id}` : '/deals'}
        className="inline-flex text-[13px] text-[#77777f] transition-colors hover:text-[#1b1b1f]"
      >
        ← Back to {deal ? 'deal' : 'deals'}
      </Link>
    </div>
  )
}
