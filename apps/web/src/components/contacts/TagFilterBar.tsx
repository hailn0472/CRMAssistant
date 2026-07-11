'use client'

import { Button } from '@/components/ui/button'
import { TagBadge } from './TagBadge'

type TagBadgeData = {
  id: string
  name: string
  color: string
}

type TagFilterBarProps = {
  selectedTags: TagBadgeData[]
  onRemoveTag: (tag: TagBadgeData) => void
  onClearAll: () => void
}

export function TagFilterBar({
  selectedTags,
  onRemoveTag,
  onClearAll,
}: TagFilterBarProps): React.JSX.Element {
  if (selectedTags.length === 0) {
    return <></>
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-slate-500">Tags:</span>
      {selectedTags.map((tag) => (
        <TagBadge key={tag.id} tag={tag} onRemove={onRemoveTag} />
      ))}
      <Button
        className="ml-1 h-6 text-xs"
        onClick={onClearAll}
        type="button"
        variant="ghost"
        size="sm"
      >
        Clear all
      </Button>
    </div>
  )
}
