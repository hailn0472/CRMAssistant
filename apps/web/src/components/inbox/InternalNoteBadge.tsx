import { StickyNote } from 'lucide-react'

export function InternalNoteBadge(): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 border border-amber-200"
      title="Only visible to agents"
    >
      <StickyNote className="h-3 w-3" />
      Internal note
    </span>
  )
}
