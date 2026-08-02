'use client'

const STAGE_CONFIGS: Record<string, { color: string; dotColor: string; bg: string; text: string }> =
  {
    Negotiation: {
      color: '#6366f1',
      dotColor: 'bg-indigo-500',
      bg: 'bg-indigo-50/80',
      text: 'text-indigo-700',
    },
    Proposal: {
      color: '#f59e0b',
      dotColor: 'bg-amber-500',
      bg: 'bg-amber-50/80',
      text: 'text-amber-700',
    },
    Qualified: {
      color: '#3b82f6',
      dotColor: 'bg-blue-500',
      bg: 'bg-blue-50/80',
      text: 'text-blue-700',
    },
    Won: {
      color: '#10b981',
      dotColor: 'bg-emerald-500',
      bg: 'bg-emerald-50/80',
      text: 'text-emerald-700',
    },
    Discovery: {
      color: '#64748b',
      dotColor: 'bg-slate-400',
      bg: 'bg-slate-100',
      text: 'text-slate-600',
    },
    Lost: { color: '#ef4444', dotColor: 'bg-rose-500', bg: 'bg-rose-50/80', text: 'text-rose-700' },
  }

export function StageBadge({
  stage,
}: {
  stage: { name: string; color?: string } | string | null | undefined
}): React.JSX.Element | null {
  if (!stage) return null
  const stageName = typeof stage === 'string' ? stage : stage.name
  const customColor = typeof stage === 'object' ? stage.color : undefined
  const config = STAGE_CONFIGS[stageName]

  if (customColor && !config) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium"
        style={{ backgroundColor: customColor + '18', color: customColor }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: customColor }} />
        {stageName}
      </span>
    )
  }

  const dot = config?.dotColor ?? 'bg-slate-400'
  const bg = config?.bg ?? 'bg-slate-100'
  const text = config?.text ?? 'text-slate-700'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${bg} ${text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
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
