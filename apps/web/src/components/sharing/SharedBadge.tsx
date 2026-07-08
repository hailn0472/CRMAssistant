'use client'

type SharedBadgeProps = {
  visible: boolean
}

export function SharedBadge({ visible }: SharedBadgeProps): React.ReactElement | null {
  if (!visible) return null

  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
      Shared
    </span>
  )
}
