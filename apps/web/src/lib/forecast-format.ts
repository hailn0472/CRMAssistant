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

type ForecastCsvBucket = {
  label: string
  weightedValue: number
  totalValue: number
  count: number
}

type ForecastCsvBand = {
  weightedValue: number
  totalValue: number
  count: number
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Renders the sales forecast (per-period buckets plus the three summary
 * bands) as a CSV string for the "Export CSV" download — pure so it stays
 * unit-testable without touching the DOM/Blob APIs.
 */
export function salesForecastToCsv(forecast: {
  buckets: ForecastCsvBucket[]
  commit: ForecastCsvBand
  bestCase: ForecastCsvBand
  pipeline: ForecastCsvBand
}): string {
  const headers = ['Period', 'Weighted value', 'Total value', 'Deals']
  const bucketRows = forecast.buckets.map((b) => [
    b.label,
    String(b.weightedValue),
    String(b.totalValue),
    String(b.count),
  ])
  const bandRows = [
    [
      'Commit',
      String(forecast.commit.weightedValue),
      String(forecast.commit.totalValue),
      String(forecast.commit.count),
    ],
    [
      'Best case',
      String(forecast.bestCase.weightedValue),
      String(forecast.bestCase.totalValue),
      String(forecast.bestCase.count),
    ],
    [
      'Pipeline',
      String(forecast.pipeline.weightedValue),
      String(forecast.pipeline.totalValue),
      String(forecast.pipeline.count),
    ],
  ]

  return [headers, ...bucketRows, [], ...bandRows]
    .map((row) => row.map(escapeCsvField).join(','))
    .join('\n')
}
