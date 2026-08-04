'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TagFilterBar } from '@/components/contacts/TagFilterBar'
import { SavedSegmentSelect } from '@/components/contacts/SavedSegmentSelect'
import { createSegment, type SavedSegment } from '@/services/segment.service'
import { searchUsers } from '@/services/owner.service'
import { cn } from '@/lib/utils'

export type ContactFilters = {
  search: string
  company: string
  jobTitle: string
  owner: { id: string; name: string } | null
  createdAtFrom: string
  createdAtTo: string
  tags: Array<{ id: string; name: string; color: string }>
}

export const emptyContactFilters: ContactFilters = {
  search: '',
  company: '',
  jobTitle: '',
  owner: null,
  createdAtFrom: '',
  createdAtTo: '',
  tags: [],
}

type ContactFilterBarProps = {
  filters: ContactFilters
  onFiltersChange: (filters: ContactFilters) => void
  /** Rendered at the far right of the toolbar row — e.g. the result count. */
  trailing?: React.ReactNode
}

const triggerClass =
  'inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-[12.5px] font-medium transition-colors'

function FilterTrigger({
  label,
  value,
  active,
  children,
}: {
  label: string
  value?: string
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          triggerClass,
          active
            ? 'border-[#1b1b1f] bg-[#fafafb] text-[#1b1b1f]'
            : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:bg-[#f4f4f6]',
        )}
      >
        {active && value ? `${label}: ${value}` : label}
        <span className="text-[9px] text-[#b4b4bd]">▾</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        {children}
      </PopoverContent>
    </Popover>
  )
}

function OwnerFilter({
  filters,
  onFiltersChange,
}: {
  filters: ContactFilters
  onFiltersChange: (filters: ContactFilters) => void
}): React.JSX.Element {
  const [term, setTerm] = useState('')

  const { data: users = [] } = useQuery({
    queryKey: ['contact-owner-options', term],
    queryFn: () => searchUsers(term),
  })

  return (
    <FilterTrigger label="Owner" value={filters.owner?.name} active={filters.owner !== null}>
      <div className="flex flex-col gap-2">
        <Input
          className="h-8 text-xs"
          placeholder="Search people..."
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="max-h-56 overflow-y-auto">
          {users.length === 0 ? (
            <p className="px-1 py-2 text-xs text-slate-400">No people found.</p>
          ) : (
            users.map((user) => {
              const name = `${user.firstName} ${user.lastName}`.trim()
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, owner: { id: user.id, name } })}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-slate-50',
                    filters.owner?.id === user.id ? 'text-slate-900' : 'text-slate-600',
                  )}
                >
                  <span className="truncate">{name || user.email}</span>
                </button>
              )
            })
          )}
        </div>
        {filters.owner ? (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, owner: null })}
            className="self-start text-[11.5px] text-slate-500 hover:text-slate-900"
          >
            Clear owner
          </button>
        ) : null}
      </div>
    </FilterTrigger>
  )
}

export function ContactFilterBar({
  filters,
  onFiltersChange,
  trailing,
}: ContactFilterBarProps): React.JSX.Element {
  const [saveOpen, setSaveOpen] = useState(false)
  const [segmentName, setSegmentName] = useState('')
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: (name: string) =>
      createSegment(name, {
        tags: filters.tags.map((t) => t.name),
        company: filters.company || undefined,
        jobTitle: filters.jobTitle || undefined,
        createdAtFrom: filters.createdAtFrom || undefined,
        createdAtTo: filters.createdAtTo || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['savedSegments'] })
      setSaveOpen(false)
      setSegmentName('')
    },
  })

  const hasActiveFilters =
    filters.tags.length > 0 ||
    filters.company !== '' ||
    filters.jobTitle !== '' ||
    filters.owner !== null ||
    filters.createdAtFrom !== '' ||
    filters.createdAtTo !== ''

  const createdLabel =
    filters.createdAtFrom && filters.createdAtTo
      ? `${filters.createdAtFrom} → ${filters.createdAtTo}`
      : filters.createdAtFrom || filters.createdAtTo

  function handleSegmentSelect(segment: SavedSegment): void {
    if (segment.id === '__create_new__') {
      setSaveOpen(true)
      return
    }
    const parsed = JSON.parse(segment.filters) as Record<string, unknown>
    const tagNames = (parsed.tags as string[]) ?? []
    // Tag names can't be resolved to tag objects without a lookup — keep the
    // ones already selected that the segment also references.
    onFiltersChange({
      ...filters,
      tags: filters.tags.filter((t) => tagNames.includes(t.name)),
      company: (parsed.company as string) ?? '',
      jobTitle: (parsed.jobTitle as string) ?? '',
      createdAtFrom: (parsed.createdAtFrom as string) ?? '',
      createdAtTo: (parsed.createdAtTo as string) ?? '',
    })
  }

  return (
    <div className="flex flex-col gap-2 border-b border-[#f2f2f5] px-[18px] py-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex h-[34px] w-[250px] max-w-full items-center gap-[9px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-[11px] transition-colors focus-within:border-[#c7c7d1] focus-within:bg-white">
          <span className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[#a0a0aa]" />
          <input
            type="text"
            aria-label="Search contacts"
            placeholder="Search name or email"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#1b1b1f] outline-none placeholder:text-[#9b9ba3]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <FilterTrigger label="Company" value={filters.company} active={filters.company !== ''}>
            <Input
              className="h-8 text-xs"
              placeholder="Company name"
              value={filters.company}
              onChange={(e) => onFiltersChange({ ...filters, company: e.target.value })}
            />
          </FilterTrigger>

          <FilterTrigger
            label="Job title"
            value={filters.jobTitle}
            active={filters.jobTitle !== ''}
          >
            <Input
              className="h-8 text-xs"
              placeholder="Job title"
              value={filters.jobTitle}
              onChange={(e) => onFiltersChange({ ...filters, jobTitle: e.target.value })}
            />
          </FilterTrigger>

          <OwnerFilter filters={filters} onFiltersChange={onFiltersChange} />

          <FilterTrigger
            label="Created"
            value={createdLabel}
            active={filters.createdAtFrom !== '' || filters.createdAtTo !== ''}
          >
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-[11.5px] text-slate-500">
                From
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={filters.createdAtFrom}
                  onChange={(e) => onFiltersChange({ ...filters, createdAtFrom: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-slate-500">
                To
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={filters.createdAtTo}
                  onChange={(e) => onFiltersChange({ ...filters, createdAtTo: e.target.value })}
                />
              </label>
            </div>
          </FilterTrigger>

          <SavedSegmentSelect onSelect={handleSegmentSelect} />

          {hasActiveFilters ? (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...emptyContactFilters, search: filters.search })}
              className="px-1.5 text-[12px] text-slate-500 transition-colors hover:text-slate-900"
            >
              Clear all
            </button>
          ) : null}
        </div>

        {trailing ? <div className="ml-auto">{trailing}</div> : null}
      </div>

      {filters.tags.length > 0 ? (
        <TagFilterBar
          selectedTags={filters.tags}
          onRemoveTag={(tag) =>
            onFiltersChange({ ...filters, tags: filters.tags.filter((t) => t.id !== tag.id) })
          }
          onClearAll={() => onFiltersChange({ ...filters, tags: [] })}
        />
      ) : null}

      {hasActiveFilters ? (
        <div className="flex">
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            className="text-[12px] text-indigo-600 transition-colors hover:text-indigo-700"
          >
            Save as segment
          </button>
        </div>
      ) : null}

      <Dialog onOpenChange={setSaveOpen} open={saveOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save segment</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Segment name"
            value={segmentName}
            onChange={(e) => setSegmentName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && segmentName.trim()) {
                void saveMutation.mutateAsync(segmentName.trim())
              }
            }}
          />
          <DialogFooter>
            <Button
              disabled={!segmentName.trim() || saveMutation.isPending}
              onClick={() => void saveMutation.mutateAsync(segmentName.trim())}
              type="button"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
