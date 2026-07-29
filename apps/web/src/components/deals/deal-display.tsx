'use client'

export function StageBadge({
  stage,
}: {
  stage: { name: string; color: string } | null | undefined
}): React.JSX.Element | null {
  if (!stage) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: stage.color + '20', color: stage.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
      {stage.name}
    </span>
  )
}

export function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency || 'USD'} ${value.toLocaleString()}`
  }
}
