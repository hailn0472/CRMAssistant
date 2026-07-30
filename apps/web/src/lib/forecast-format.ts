/**
 * Format a variance value with sign (+/-).
 */
export function formatVariance(value: number | null): string {
  if (value === null) return '—'
  if (value > 0) return `+${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (value < 0) return `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return '0'
}

/**
 * Label for accuracy percentage band.
 */
export function accuracyBand(accuracyPct: number | null): string {
  if (accuracyPct === null) return 'No data'
  if (accuracyPct >= 95) return 'On track'
  if (accuracyPct >= 80) return 'Close'
  if (accuracyPct >= 50) return 'Off track'
  return 'Significantly off'
}

/**
 * Axis tick formatter — show short month labels for chart.
 */
export function formatAxisTick(label: string): string {
  // "Aug 2026" → "Aug"
  // "Q3 2026" → "Q3"
  const parts = label.split(' ')
  if (parts.length >= 2) {
    return parts[0]
  }
  return label
}
