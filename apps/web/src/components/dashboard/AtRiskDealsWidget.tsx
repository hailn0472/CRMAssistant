'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/shared'
import { formatCurrency } from '@/components/deals/deal-display'
import { getAtRiskDeals } from '@/services/deal-health.service'
import {
  HEALTH_SIGNAL_LABELS,
  HEALTH_STATUS_LABELS,
  healthBadgeVariant,
} from '@/lib/deal-health-format'

const WIDGET_LIMIT = 5

export function AtRiskDealsWidget(): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['deals', 'atRisk'],
    queryFn: () => getAtRiskDeals({ page: 1, pageSize: 20 }),
  })

  if (isLoading) {
    return <LoadingSkeleton />
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load at-risk deals"
        message="We couldn't fetch your at-risk deals. Please try again in a moment."
        onRetry={() => refetch()}
      />
    )
  }

  if (!data || data.total === 0) {
    return (
      <EmptyState
        title="You're all caught up."
        description="No deals need attention right now. New at-risk deals will appear here."
      />
    )
  }

  const visibleDeals = data.items.slice(0, WIDGET_LIMIT)

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm text-slate-500">At-risk deals</p>
            <p className="text-2xl font-semibold text-slate-950">
              {data.total} {data.total === 1 ? 'deal' : 'deals'}
            </p>
          </div>
          <Badge variant="warning">Needs attention</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-slate-100">
          {visibleDeals.map((item) => {
            const topReason = item.health.signals[0]
            return (
              <li key={item.deal.id}>
                <Link
                  href={`/deals/${item.deal.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-950">{item.deal.title}</p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {item.deal.owner
                        ? `${item.deal.owner.firstName} ${item.deal.owner.lastName}`
                        : ''}{' '}
                      <span aria-hidden="true">&middot;</span>{' '}
                      <Badge
                        variant={healthBadgeVariant(item.health.status)}
                        className="text-[11px]"
                      >
                        {HEALTH_STATUS_LABELS[item.health.status]}
                      </Badge>{' '}
                      {topReason ? HEALTH_SIGNAL_LABELS[topReason] ?? topReason : null}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-slate-700">
                    {formatCurrency(item.deal.value, item.deal.currency)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
