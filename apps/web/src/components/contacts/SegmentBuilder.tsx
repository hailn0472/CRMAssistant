'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

export type SegmentFilters = {
  tags: Array<{ id: string; name: string; color: string }>
  company: string
  jobTitle: string
  createdAtFrom: string
  createdAtTo: string
}

type SegmentBuilderProps = {
  filters: SegmentFilters
  onFiltersChange: (filters: SegmentFilters) => void
}

export function SegmentBuilder({
  filters,
  onFiltersChange,
}: SegmentBuilderProps): React.JSX.Element {
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
    filters.createdAtFrom !== '' ||
    filters.createdAtTo !== ''

  function handleSegmentSelect(segment: SavedSegment): void {
    if (segment.id === '__create_new__') {
      setSaveOpen(true)
      return
    }
    const parsed = JSON.parse(segment.filters) as Record<string, unknown>
    const tagNames = (parsed.tags as string[]) ?? []
    // We can't resolve tag names to tag objects without a lookup —
    // pass the names and let the parent handle resolution via the filter
    onFiltersChange({
      tags: filters.tags.filter((t) => tagNames.includes(t.name)),
      company: (parsed.company as string) ?? '',
      jobTitle: (parsed.jobTitle as string) ?? '',
      createdAtFrom: (parsed.createdAtFrom as string) ?? '',
      createdAtTo: (parsed.createdAtTo as string) ?? '',
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Company filter */}
        <Input
          className="h-8 w-[160px] text-xs"
          placeholder="Company..."
          value={filters.company}
          onChange={(e) => onFiltersChange({ ...filters, company: e.target.value })}
        />
        {/* Job title filter */}
        <Input
          className="h-8 w-[160px] text-xs"
          placeholder="Job title..."
          value={filters.jobTitle}
          onChange={(e) => onFiltersChange({ ...filters, jobTitle: e.target.value })}
        />
        {/* Created at from */}
        <Input
          className="h-8 w-[140px] text-xs"
          type="date"
          value={filters.createdAtFrom}
          onChange={(e) => onFiltersChange({ ...filters, createdAtFrom: e.target.value })}
        />
        {/* Created at to */}
        <Input
          className="h-8 w-[140px] text-xs"
          type="date"
          value={filters.createdAtTo}
          onChange={(e) => onFiltersChange({ ...filters, createdAtTo: e.target.value })}
        />

        {/* Saved segment selector */}
        <SavedSegmentSelect onSelect={handleSegmentSelect} />
      </div>

      {filters.tags.length > 0 ? (
        <TagFilterBar
          selectedTags={filters.tags}
          onRemoveTag={(tag) =>
            onFiltersChange({
              ...filters,
              tags: filters.tags.filter((t) => t.id !== tag.id),
            })
          }
          onClearAll={() => onFiltersChange({ ...filters, tags: [] })}
        />
      ) : null}

      {/* Save as segment button */}
      {hasActiveFilters ? (
        <div className="flex gap-1">
          <Button
            className="h-7 text-xs"
            onClick={() => setSaveOpen(true)}
            type="button"
            variant="outline"
            size="sm"
          >
            Save as segment
          </Button>
        </div>
      ) : null}

      {/* Save segment dialog */}
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
