'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { SharedBadge } from '@/components/sharing/SharedBadge'
import { TagBadge } from '@/components/contacts/TagBadge'
import { OwnerCell } from '@/components/contacts/OwnerCell'
import { BulkAssignDialog } from '@/components/contacts/BulkAssignDialog'
import { ContactFilterBar, type ContactFilters } from '@/components/contacts/ContactFilterBar'
import { getContacts } from '@/services/contact.service'
import { assignContactOwnerBulk } from '@/services/owner.service'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

const LEAD_STATUS_LABELS = {
  NEW: 'New',
  REVIEWING: 'Reviewing',
  NURTURING: 'Nurturing',
  QUALIFIED_LEAD: 'Qualified lead',
  NOT_A_LEAD: 'Not a lead',
} as const

// ─── Pagination ────────────────────────────────────────
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
        Showing {Math.min((page - 1) * pageSize + 1, total)}
        {'–'}
        {Math.min(page * pageSize, total)} of {total} contacts
      </span>

      <div className="flex items-center gap-[5px]">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border border-[#e6e6eb] bg-white px-2 text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:pointer-events-none disabled:opacity-30"
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
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="flex h-[30px] min-w-[30px] items-center justify-center rounded-lg border border-[#e6e6eb] bg-white px-2 text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Avatar initials ──────────────────────────────────
function AvatarCell({
  firstName,
  lastName,
}: {
  firstName: string
  lastName: string
}): React.JSX.Element {
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f0f0f3] text-[10.5px] font-semibold text-[#4b4b55]">
      {initials}
    </span>
  )
}

// ─── Main component ───────────────────────────────────
type ContactsTableProps = {
  filters: ContactFilters
  onFiltersChange: (filters: ContactFilters) => void
}

export function ContactsTable({ filters, onFiltersChange }: ContactsTableProps): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: [
      'contacts',
      page,
      filters.search,
      filters.company,
      filters.jobTitle,
      filters.owner?.id ?? '',
      filters.tags.map((t) => t.name),
      filters.createdAtFrom,
      filters.createdAtTo,
    ],
    queryFn: () =>
      getContacts(page, PAGE_SIZE, {
        search: filters.search || undefined,
        company: filters.company || undefined,
        jobTitle: filters.jobTitle || undefined,
        ownerId: filters.owner?.id || undefined,
        tags: filters.tags.length > 0 ? filters.tags.map((t) => t.name) : undefined,
        createdAtFrom: filters.createdAtFrom || undefined,
        createdAtTo: filters.createdAtTo || undefined,
      }),
    // Keep the previous page visible while the next page/filter result is
    // loading; this avoids a full skeleton flash during normal navigation.
    placeholderData: keepPreviousData,
  })

  function handleFiltersChange(next: ContactFilters): void {
    onFiltersChange(next)
    setPage(1)
  }

  if (isLoading) return <TableSkeleton rows={5} columns={8} />

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Unable to load contacts.'}
        onRetry={() => refetch()}
      />
    )
  }

  const isFiltered =
    filters.search !== '' ||
    filters.company !== '' ||
    filters.jobTitle !== '' ||
    filters.owner !== null ||
    filters.createdAtFrom !== '' ||
    filters.createdAtTo !== '' ||
    filters.tags.length > 0

  // Only the unfiltered empty result means the workspace is genuinely empty.
  // A filtered miss keeps the card so the filter bar stays reachable.
  if ((!data || data.items.length === 0) && !isFiltered) {
    return (
      <EmptyState
        title="No contacts yet"
        description="Create your first contact, or import them in bulk from a CSV file."
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/contacts/import">Import CSV</Link>
            </Button>
            <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
              <Link href="/contacts/new">Create contact</Link>
            </Button>
          </div>
        }
      />
    )
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const allSelected = items.length > 0 && selectedIds.size === items.length

  return (
    <>
      <Card className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white shadow-none">
        <ContactFilterBar
          filters={filters}
          onFiltersChange={handleFiltersChange}
          trailing={
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setBulkAssignOpen(true)}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-indigo-200 bg-white px-3 text-[12.5px] font-medium text-indigo-700 transition-colors hover:bg-indigo-50"
                >
                  <User className="h-3.5 w-3.5" />
                  Assign owner ({selectedIds.size})
                </button>
              ) : null}
              <span className="text-[12.5px] font-medium text-[#8c8c96]">{total} contacts</span>
            </div>
          }
        />

        <ResponsiveTableWrapper>
          <table className="w-full min-w-[1150px] text-left text-[13.5px]">
            <thead>
              <tr className="h-[40px] border-b border-[#f2f2f5] bg-[#fafafb] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8c8c96]">
                <th className="w-9 py-2.5 pl-[18px] pr-2">
                  <input
                    type="checkbox"
                    aria-label="Select all contacts"
                    checked={allSelected}
                    onChange={() => {
                      if (allSelected) {
                        setSelectedIds(new Set())
                      } else {
                        setSelectedIds(new Set(items.map((c) => c.id)))
                      }
                    }}
                    className="h-[15px] w-[15px] rounded border-[#e6e6eb] accent-[#1b1b1f]"
                  />
                </th>
                <th className="py-2.5 pr-4">Name</th>
                <th className="py-2.5 pr-4">Email</th>
                <th className="py-2.5 pr-4">Company</th>
                <th className="py-2.5 pr-4">Job title</th>
                <th className="py-2.5 pr-4">Lead status</th>
                <th className="py-2.5 pr-4">Owner</th>
                <th className="py-2.5 pr-[18px]">Tags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f7]">
              {items.map((contact) => (
                <tr
                  className="group h-[56px] border-b border-[#f4f4f7] transition-colors hover:bg-[#fafafb]"
                  key={contact.id}
                >
                  <td className="py-3 pl-[18px] pr-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${contact.firstName} ${contact.lastName}`}
                      checked={selectedIds.has(contact.id)}
                      onChange={() => {
                        const next = new Set(selectedIds)
                        if (next.has(contact.id)) {
                          next.delete(contact.id)
                        } else {
                          next.add(contact.id)
                        }
                        setSelectedIds(next)
                      }}
                      className="h-[15px] w-[15px] rounded border-[#e6e6eb] accent-[#1b1b1f]"
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="flex min-w-0 items-center gap-2.5 font-medium text-[#1b1b1f] transition-colors hover:text-indigo-600"
                    >
                      <AvatarCell firstName={contact.firstName} lastName={contact.lastName} />
                      <span className="truncate">
                        {contact.firstName} {contact.lastName}
                        <SharedBadge visible={!!contact.sharedWithMe} />
                      </span>
                    </Link>
                  </td>
                  <td className="max-w-[260px] truncate py-3 pr-4 text-[13px]">
                    <a href={`mailto:${contact.email}`} className="text-[#4338ca] hover:underline">
                      {contact.email}
                    </a>
                  </td>
                  <td className="max-w-[160px] truncate py-3 pr-4 text-[#4b4b55]">
                    {contact.company ?? <span className="italic text-[#b4b4bd]">&mdash;</span>}
                  </td>
                  <td className="max-w-[160px] truncate py-3 pr-4 text-[12.5px] text-[#8c8c96]">
                    {contact.jobTitle ?? <span className="italic text-[#b4b4bd]">&mdash;</span>}
                  </td>
                  <td className="py-3 pr-4 text-[12.5px] font-medium text-[#4b4b55]">
                    {LEAD_STATUS_LABELS[contact.leadStatus ?? 'NEW']}
                  </td>
                  <td className="py-3 pr-4 text-[12.5px] text-[#4b4b55]">
                    <OwnerCell ownerId={contact.ownerId} owner={contact.owner} />
                  </td>
                  <td className="py-3 pr-[18px]">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.map((t) => <TagBadge key={t.id} tag={t} />)
                      ) : (
                        <span className="italic text-slate-300">&mdash;</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-[18px] py-10 text-center text-[13px] text-slate-500"
                  >
                    No contacts match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </ResponsiveTableWrapper>

        {items.length > 0 ? (
          <div className="border-t border-slate-100 px-[18px] py-3.5">
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

      <BulkAssignDialog
        open={bulkAssignOpen}
        onOpenChange={setBulkAssignOpen}
        contactIds={Array.from(selectedIds)}
        onAssignBulk={async (contactIds, userId) => {
          const result = await assignContactOwnerBulk(contactIds, userId)
          if (result.failedCount === 0) {
            setSelectedIds(new Set())
          }
          return result
        }}
      />
    </>
  )
}
