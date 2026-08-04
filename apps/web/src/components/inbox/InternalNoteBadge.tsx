import { StickyNote } from 'lucide-react'

export function InternalNoteBadge(): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[#fdf6e7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#8a6c1f] border border-[#f0dfae]"
      title="Only visible to agents"
    >
      <StickyNote className="h-3 w-3" />
      Internal note
    </span>
  )
}
