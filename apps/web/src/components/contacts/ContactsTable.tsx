'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Upload, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { SharedBadge } from '@/components/sharing/SharedBadge'
import { TagBadge } from '@/components/contacts/TagBadge'
import { SegmentBuilder } from '@/components/contacts/SegmentBuilder'
import { ExportButton } from '@/components/contacts/ExportButton'
import { OwnerCell } from '@/components/contacts/OwnerCell'
import { BulkAssignDialog } from '@/components/contacts/BulkAssignDialog'
import { getContacts } from '@/services/contact.service'
import { assignContactOwnerBulk } from '@/services/owner.service'
import { cn } from '@/lib/utils'
import type { SegmentFilters } from '@/components/contacts/SegmentBuilder'
import type { ExportFilters } from '@/types/import-export.types'

const PAGE_SIZE = 10

// ─── Pagination ────────────────────────────────────────
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
        <strong className="text-slate-700">{total}</strong> contacts
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

// ─── Avatar initials ──────────────────────────────────
function AvatarCell({
  firstName,
  lastName,
}: {
  firstName: string
  lastName: string
}): React.JSX.Element {
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
  const colors = [
    'from-indigo-500 to-blue-600',
    'from-emerald-500 to-teal-600',
    'from-purple-500 to-pink-600',
    'from-amber-500 to-orange-600',
  ]
  const idx = (firstName.charCodeAt(0) + lastName.charCodeAt(0)) % colors.length
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm',
        `bg-gradient-to-br ${colors[idx]}`,
      )}
    >
      {initials}
    </span>
  )
}

// ─── Main component ───────────────────────────────────
export function ContactsTable(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [filterTags, setFilterTags] = useState<Array<{ id: string; name: string; color: string }>>(
    [],
  )
  const [filterCompany, setFilterCompany] = useState('')
  const [filterJobTitle, setFilterJobTitle] = useState('')
  const [filterCreatedAtFrom, setFilterCreatedAtFrom] = useState('')
  const [filterCreatedAtTo, setFilterCreatedAtTo] = useState('')

  const segmentFilters: SegmentFilters = {
    tags: filterTags,
    company: filterCompany,
    jobTitle: filterJobTitle,
    createdAtFrom: filterCreatedAtFrom,
    createdAtTo: filterCreatedAtTo,
  }

  const exportFilters: ExportFilters = {
    tags: filterTags.length > 0 ? filterTags.map((t) => t.name) : undefined,
    company: filterCompany || undefined,
    jobTitle: filterJobTitle || undefined,
    createdAtFrom: filterCreatedAtFrom || undefined,
    createdAtTo: filterCreatedAtTo || undefined,
  }

  const toolbarActions = (
    <div className="flex items-center gap-2">
      {selectedIds.size > 0 ? (
        <Button
          variant="outline"
          className="gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
          onClick={() => setBulkAssignOpen(true)}
        >
          <User className="h-3.5 w-3.5" />
          Assign Owner ({selectedIds.size})
        </Button>
      ) : null}
      <Button asChild variant="outline" className="gap-1.5">
        <Link href="/contacts/import">
          <Upload className="h-3.5 w-3.5" />
          Import
        </Link>
      </Button>
      <ExportButton filters={exportFilters} />
      <Button asChild className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white">
        <Link href="/contacts/new">
          <Plus className="h-3.5 w-3.5" />
          Create contact
        </Link>
      </Button>
    </div>
  )

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: [
      'contacts',
      page,
      filterTags.map((t) => t.name),
      filterCompany,
      filterJobTitle,
      filterCreatedAtFrom,
      filterCreatedAtTo,
    ],
    queryFn: () =>
      getContacts(page, PAGE_SIZE, {
        tags: filterTags.length > 0 ? filterTags.map((t) => t.name) : undefined,
        company: filterCompany || undefined,
        jobTitle: filterJobTitle || undefined,
        createdAtFrom: filterCreatedAtFrom || undefined,
        createdAtTo: filterCreatedAtTo || undefined,
      }),
  })

  if (isLoading) return <TableSkeleton rows={5} columns={4} />

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Unable to load contacts.'}
        onRetry={() => refetch()}
      />
    )
  }

  if (!data || data.items.length === 0) {
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

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1)

  return (
    <div className="space-y-4">
      {/* Workspace Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">CRM</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">Contacts</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your customer relationships — filter, export, and edit in place.
          </p>
        </div>
        {toolbarActions}
      </div>

      {/* Filters */}
      <SegmentBuilder
        filters={segmentFilters}
        onFiltersChange={(f) => {
          setFilterTags(f.tags)
          setFilterCompany(f.company)
          setFilterJobTitle(f.jobTitle)
          setFilterCreatedAtFrom(f.createdAtFrom)
          setFilterCreatedAtTo(f.createdAtTo)
          setPage(1)
        }}
      />

      {/* Table Card */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <ResponsiveTableWrapper>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="w-10 py-3 pl-4 pr-2">
                  <input
                    type="checkbox"
                    checked={data.items.length > 0 && selectedIds.size === data.items.length}
                    onChange={() => {
                      if (selectedIds.size === data.items.length) {
                        setSelectedIds(new Set())
                      } else {
                        setSelectedIds(new Set(data.items.map((c) => c.id)))
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="py-3 pl-5 pr-4">Name</th>
                <th className="py-3 pr-4">Email</th>
                <th className="py-3 pr-4">Owner</th>
                <th className="py-3 pr-4">Company</th>
                <th className="py-3 pr-4">Job Title</th>
                <th className="py-3 pr-5">Tags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((contact) => (
                <tr className="group transition-colors hover:bg-slate-50" key={contact.id}>
                  <td className="py-3 pl-4 pr-2">
                    <input
                      type="checkbox"
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
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="py-3 pl-5 pr-4">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="flex items-center gap-3 font-medium text-slate-900 hover:text-indigo-600 transition-colors"
                    >
                      <AvatarCell firstName={contact.firstName} lastName={contact.lastName} />
                      <span className="truncate">
                        {contact.firstName} {contact.lastName}
                        <SharedBadge visible={!!contact.sharedWithMe} />
                      </span>
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-slate-500">{contact.email}</td>
                  <td className="py-3 pr-4">
                    <OwnerCell ownerId={contact.ownerId} owner={contact.owner} />
                  </td>
                  <td className="py-3 pr-4 text-slate-500">
                    {contact.company ?? <span className="italic text-slate-300">—</span>}
                  </td>
                  <td className="py-3 pr-4 text-slate-500">
                    {contact.jobTitle ?? <span className="italic text-slate-300">—</span>}
                  </td>
                  <td className="py-3 pr-5">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.map((t) => <TagBadge key={t.id} tag={t} />)
                      ) : (
                        <span className="italic text-slate-300">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>

        {/* Pagination */}
        <div className="border-t border-slate-100 px-5 py-3">
          <Pagination
            page={data.page}
            totalPages={totalPages}
            total={data.total}
            onChange={setPage}
          />
        </div>
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
    </div>
  )
}
