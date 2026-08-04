'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { StageBadge, formatCurrency, formatCloseDate } from '@/components/deals/deal-display'
import { DealFilterBar, emptyDealFilters, type DealFilters } from '@/components/deals/DealFilterBar'
import { getDeals } from '@/services/deal.service'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

function Pagination({
  page,
  pageSize,
  totalPages,
  total,
  onChange,
}: {
  page: number
  pageSize: number
  totalPages: number
  total: number
  onChange: (p: number) => void
}): React.JSX.Element {
  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const result: (number | 'ellipsis')[] = [1]
    if (page > 3) result.push('ellipsis')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      result.push(i)
    }
    if (page < totalPages - 2) result.push('ellipsis')
    result.push(totalPages)
    return result
  }, [page, totalPages])

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[12.5px] text-[#8c8c96]">
        Showing {(page - 1) * pageSize + 1}
        {'–'}
        {Math.min(page * pageSize, total)} of {total} deals
      </span>
      <div className="flex items-center gap-[5px]">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border border-[#e6e6eb] bg-white px-2 text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span
              key={`e${i}`}
              className="flex h-[30px] w-6 select-none items-center justify-center px-[3px] text-[12.5px] text-[#b4b4bd]"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                'flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border px-2 text-[12.5px] font-medium transition-colors',
                p === page
                  ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white font-semibold shadow-none'
                  : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:bg-[#f4f4f6]',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border border-[#e6e6eb] bg-white px-2 text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function DealsTable(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<DealFilters>(emptyDealFilters)

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['deals', page, filters],
    queryFn: () =>
      getDeals(page, PAGE_SIZE, {
        search: filters.search || undefined,
        stageId: filters.stage?.id || undefined,
        ownerId: filters.owner?.id || undefined,
        expectedCloseDateFrom: filters.closeDateFrom || undefined,
        expectedCloseDateTo: filters.closeDateTo || undefined,
      }),
  })

  function handleFiltersChange(next: DealFilters): void {
    setFilters(next)
    setPage(1)
  }

  if (isLoading) return <TableSkeleton rows={5} columns={6} />

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Unable to load deals.'}
        onRetry={() => refetch()}
      />
    )
  }

  const isFiltered =
    filters.search !== '' ||
    filters.stage !== null ||
    filters.owner !== null ||
    filters.closeDateFrom !== '' ||
    filters.closeDateTo !== ''

  if ((!data || data.items.length === 0) && !isFiltered) {
    return (
      <EmptyState
        title="No deals yet"
        description="Create your first deal to start tracking opportunities through your sales pipeline."
        action={
          <Button asChild className="bg-[#1b1b1f] text-white hover:bg-black">
            <Link href="/deals/new">Create deal</Link>
          </Button>
        }
      />
    )
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)

  return (
    <Card className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white shadow-none">
      <DealFilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        trailing={<span className="text-[12.5px] font-medium text-[#8c8c96]">{total} deals</span>}
      />

      <ResponsiveTableWrapper>
        <table className="w-full min-w-[880px] text-left text-[13.5px]">
          <thead>
            <tr className="h-[40px] border-b border-[#f2f2f5] bg-[#fafafb] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8c8c96]">
              <th className="py-2.5 pl-[18px] pr-4">Deal</th>
              <th className="py-2.5 pr-4 text-right">Value</th>
              <th className="py-2.5 pr-4 pl-[18px]">Stage</th>
              <th className="py-2.5 pr-4">Contact</th>
              <th className="py-2.5 pr-4">Owner</th>
              <th className="py-2.5 pr-4">Expected close</th>
              <th className="py-2.5 pr-[18px] w-6"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f4f4f7]">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-[18px] py-10 text-center text-[13px] text-[#8c8c96]">
                  No deals match these filters.
                </td>
              </tr>
            ) : null}
            {items.map((deal) => (
              <tr
                className="group h-[56px] border-b border-[#f4f4f7] cursor-pointer transition-colors hover:bg-[#fafafb]"
                key={deal.id}
                onClick={() => (window.location.href = `/deals/${deal.id}`)}
              >
                <td className="py-3 pl-[18px] pr-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[#f0f0f3] text-[10.5px] font-semibold text-[#6b6b76]">
                      {deal.title
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join('')}
                    </span>
                    <span className="truncate font-medium text-[#1b1b1f] transition-colors">
                      {deal.title}
                    </span>
                  </div>
                </td>
                <td className="py-3 pr-4 text-right font-mono text-[12.5px] text-[#1b1b1f]">
                  {formatCurrency(deal.value, deal.currency)}
                </td>
                <td className="py-3 pr-4 pl-[18px]">
                  <StageBadge stage={deal.stage} />
                </td>
                <td className="py-3 pr-4 truncate">
                  {deal.contact ? (
                    <Link
                      href={`/contacts/${deal.contact.id}`}
                      className="text-[#4338ca] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {deal.contact.firstName} {deal.contact.lastName}
                    </Link>
                  ) : (
                    <span className="italic text-[#b4b4bd]">&mdash;</span>
                  )}
                </td>
                <td className="py-3 pr-4 truncate text-[#4b4b55]">
                  {deal.owner ? (
                    `${deal.owner.firstName} ${deal.owner.lastName}`
                  ) : (
                    <span className="italic text-[#b4b4bd]">&mdash;</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-[12.5px] text-[#8c8c96]">
                  {formatCloseDate(deal.expectedCloseDate)}
                </td>
                <td className="py-3 pr-[18px] text-right">
                  <ChevronRight className="inline-block h-3.5 w-3.5 text-[#b4b4bd] group-hover:text-[#4b4b55] transition-colors" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      {items.length > 0 ? (
        <div className="border-t border-[#f2f2f5] px-[18px] py-3.5">
          <Pagination
            page={data?.page ?? page}
            pageSize={pageSize}
            totalPages={totalPages}
            total={total}
            onChange={setPage}
          />
        </div>
      ) : null}
    </Card>
  )
}
