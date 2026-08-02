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
      <span className="text-[12.5px] text-slate-500">
        Showing {(page - 1) * pageSize + 1}
        {'–'}
        {Math.min(page * pageSize, total)} of {total} deals
      </span>
      <div className="flex items-center gap-[5px]">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span
              key={`e${i}`}
              className="flex h-[30px] w-6 items-center justify-center px-[3px] text-[12.5px] text-slate-300 select-none"
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
                  ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100',
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
          className="flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function DealsTable(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [searchFilter, setSearchFilter] = useState('')

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['deals', page, searchFilter],
    queryFn: () =>
      getDeals(page, PAGE_SIZE, {
        search: searchFilter || undefined,
      }),
  })

  if (isLoading) return <TableSkeleton rows={5} columns={6} />

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Unable to load deals.'}
        onRetry={() => refetch()}
      />
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="No deals yet"
        description="Create your first deal to start tracking opportunities through your sales pipeline."
        action={
          <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
            <Link href="/deals/new">Create deal</Link>
          </Button>
        }
      />
    )
  }

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1)

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-none">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 px-[18px] py-3.5">
        <div className="flex h-[34px] w-[240px] max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 transition-colors focus-within:border-slate-300 focus-within:bg-white">
          <span className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-slate-400" />
          <input
            type="text"
            placeholder="Search deals"
            value={searchFilter}
            onChange={(e) => {
              setSearchFilter(e.target.value)
              setPage(1)
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Stage <span className="text-[10px] text-slate-400">▾</span>
          </button>
          <button
            type="button"
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Owner <span className="text-[10px] text-slate-400">▾</span>
          </button>
          <button
            type="button"
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Close date <span className="text-[10px] text-slate-400">▾</span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12.5px] text-slate-400 font-medium">{data.total} deals</span>
        </div>
      </div>

      <ResponsiveTableWrapper>
        <table className="w-full min-w-[880px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-2.5 pl-[18px] pr-4">Deal</th>
              <th className="py-2.5 pr-4 text-right">Value</th>
              <th className="py-2.5 pr-4">Stage</th>
              <th className="py-2.5 pr-4">Contact</th>
              <th className="py-2.5 pr-4">Owner</th>
              <th className="py-2.5 pr-4">Expected close</th>
              <th className="py-2.5 pr-[18px] w-6"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map((deal) => (
              <tr
                className="group cursor-pointer transition-colors hover:bg-slate-50/80"
                key={deal.id}
                onClick={() => (window.location.href = `/deals/${deal.id}`)}
              >
                <td className="py-3 pl-[18px] pr-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-slate-100 text-[10.5px] font-semibold text-slate-500">
                      {deal.title
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join('')}
                    </span>
                    <span className="truncate font-medium text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {deal.title}
                    </span>
                  </div>
                </td>
                <td className="py-3 pr-4 text-right font-mono text-[12.5px] text-slate-900">
                  {formatCurrency(deal.value, deal.currency)}
                </td>
                <td className="py-3 pr-4">
                  <StageBadge stage={deal.stage} />
                </td>
                <td className="py-3 pr-4 truncate">
                  {deal.contact ? (
                    <Link
                      href={`/contacts/${deal.contact.id}`}
                      className="text-indigo-600 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {deal.contact.firstName} {deal.contact.lastName}
                    </Link>
                  ) : (
                    <span className="italic text-slate-300">&mdash;</span>
                  )}
                </td>
                <td className="py-3 pr-4 truncate text-slate-600">
                  {deal.owner ? (
                    `${deal.owner.firstName} ${deal.owner.lastName}`
                  ) : (
                    <span className="italic text-slate-300">&mdash;</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-[12.5px] text-slate-500">
                  {formatCloseDate(deal.expectedCloseDate)}
                </td>
                <td className="py-3 pr-[18px] text-right">
                  <ChevronRight className="inline-block h-3.5 w-3.5 text-slate-300 group-hover:text-slate-400 transition-colors" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      <div className="border-t border-slate-100 px-[18px] py-3.5">
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          totalPages={totalPages}
          total={data.total}
          onChange={setPage}
        />
      </div>
    </Card>
  )
}
