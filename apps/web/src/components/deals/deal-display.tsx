'use client'

/**
 * Fallback dot colours for the well-known default stages. A stage that carries
 * its own `color` from the pipeline settings always wins over this map.
 */
const STAGE_DOT_COLORS: Record<string, string> = {
  Negotiation: '#4f46e5',
  Proposal: '#c2860a',
  Qualified: '#4f46e5',
  Won: '#22a06b',
  Discovery: '#8c8c96',
  Lost: '#b91c1c',
}

export function StageBadge({
  stage,
}: {
  stage: { name: string; color?: string } | string | null | undefined
}): React.JSX.Element | null {
  if (!stage) return null
  const stageName = typeof stage === 'string' ? stage : stage.name
  const customColor = typeof stage === 'object' ? stage.color : undefined

  const dotBg = customColor || STAGE_DOT_COLORS[stageName] || '#8c8c96'

  return (
    <span className="inline-flex items-center gap-[6px] rounded-full bg-[#f4f4f6] px-[9px] py-[3px] text-[11.5px] font-medium text-[#4b4b55]">
      <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ backgroundColor: dotBg }} />
      {stageName}
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

export function formatCloseDate(dateString?: string | null): string {
  if (!dateString) return '—'
  try {
    const d = new Date(dateString)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
  } catch {
    return '—'
  }
}
