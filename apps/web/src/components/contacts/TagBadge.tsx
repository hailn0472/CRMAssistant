import { X } from 'lucide-react'

type TagBadgeData = {
  id: string
  name: string
  color: string
}

type TagBadgeProps = {
  tag: TagBadgeData
  onRemove?: (tag: TagBadgeData) => void
}

export function TagBadge({ tag, onRemove }: TagBadgeProps): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
    >
      {tag.name}
      {onRemove ? (
        <button
          className="ml-0.5 inline-flex items-center rounded-full p-0.5 hover:bg-black/10"
          onClick={() => onRemove(tag)}
          type="button"
          aria-label={`Remove tag ${tag.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  )
}
