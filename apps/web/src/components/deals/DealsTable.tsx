'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { getDeals } from '@/services/deal.service'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number
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
    <div className="flex items-center justify-between text-sm text-slate-500">
      <span className="text-xs">
        <strong className="text-slate-700">{total}</strong> deals
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span
              key={`e${i}`}
              className="flex h-8 w-6 items-center justify-center text-xs text-slate-300 select-none"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                'flex h-8 min-w-[32px] items-center justify-center rounded-md px-2 text-xs font-medium transition-colors',
                p === page
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
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
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function StageBadge({
  stage,
}: {
  stage: { name: string; color: string } | null | undefined
}): React.JSX.Element | null {
  if (!stage) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: stage.color + '20', color: stage.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
      {stage.name}
    </span>
  )
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency || 'USD'} ${value.toLocaleString()}`
  }
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
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">CRM</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">Deals</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track and manage your sales opportunities through the pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white">
            <Link href="/deals/new">
              <Plus className="h-3.5 w-3.5" />
              Create deal
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search deals..."
          value={searchFilter}
          onChange={(e) => {
            setSearchFilter(e.target.value)
            setPage(1)
          }}
          className="h-9 rounded-md border border-slate-300 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <ResponsiveTableWrapper>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 pl-5 pr-4">Title</th>
                <th className="py-3 pr-4">Value</th>
                <th className="py-3 pr-4">Stage</th>
                <th className="py-3 pr-4">Contact</th>
                <th className="py-3 pr-4">Owner</th>
                <th className="py-3 pr-5">Expected Close</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((deal) => (
                <tr
                  className="group transition-colors hover:bg-slate-50 cursor-pointer"
                  key={deal.id}
                  onClick={() => (window.location.href = `/deals/${deal.id}`)}
                >
                  <td className="py-3 pl-5 pr-4">
                    <span className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {deal.title}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-slate-700 font-medium">
                    {formatCurrency(deal.value, deal.currency)}
                  </td>
                  <td className="py-3 pr-4">
                    <StageBadge stage={deal.stage} />
                  </td>
                  <td className="py-3 pr-4">
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
                  <td className="py-3 pr-4 text-slate-500">
                    {deal.owner ? (
                      `${deal.owner.firstName} ${deal.owner.lastName}`
                    ) : (
                      <span className="italic text-slate-300">&mdash;</span>
                    )}
                  </td>
                  <td className="py-3 pr-5 text-slate-500">
                    {deal.expectedCloseDate ? (
                      new Date(deal.expectedCloseDate).toLocaleDateString()
                    ) : (
                      <span className="italic text-slate-300">&mdash;</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>

        <div className="border-t border-slate-100 px-5 py-3">
          <Pagination
            page={data.page}
            totalPages={totalPages}
            total={data.total}
            onChange={setPage}
          />
        </div>
      </Card>
    </div>
  )
}
