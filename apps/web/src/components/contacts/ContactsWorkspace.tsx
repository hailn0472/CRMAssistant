'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'

import { ContactMetricsCards } from '@/components/contacts/ContactMetricsCards'
import { ContactsTable } from '@/components/contacts/ContactsTable'
import { ExportButton } from '@/components/contacts/ExportButton'
import { ContactFormDrawer } from '@/components/contacts/ContactFormDrawer'
import { emptyContactFilters, type ContactFilters } from '@/components/contacts/ContactFilterBar'
import type { ExportFilters } from '@/types/import-export.types'

const secondaryLinkClass =
  'inline-flex h-[36px] items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]'

export function ContactsWorkspace(): React.JSX.Element {
  // Filters live here so the header's Export CSV action exports exactly what
  // the table is currently showing.
  const [filters, setFilters] = useState<ContactFilters>(emptyContactFilters)
  const [createOpen, setCreateOpen] = useState(false)

  const exportFilters: ExportFilters = useMemo(
    () => ({
      tags: filters.tags.length > 0 ? filters.tags.map((t) => t.name) : undefined,
      company: filters.company || undefined,
      jobTitle: filters.jobTitle || undefined,
      createdAtFrom: filters.createdAtFrom || undefined,
      createdAtTo: filters.createdAtTo || undefined,
    }),
    [filters],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">Contacts</h1>
          <p className="text-[13.5px] text-[#77777f]">
            Manage customer relationships — filter, export and edit in place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/contacts/import" className={secondaryLinkClass}>
            Import
          </Link>
          <ExportButton filters={exportFilters} />
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-[36px] items-center gap-1.5 rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black"
          >
            <Plus className="h-3.5 w-3.5" />
            Create contact
          </button>
        </div>
      </div>

      <ContactMetricsCards />

      <ContactsTable filters={filters} onFiltersChange={setFilters} />

      <ContactFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
