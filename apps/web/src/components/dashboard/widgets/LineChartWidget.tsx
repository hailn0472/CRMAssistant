'use client'

import type { WidgetResultData } from '@/services/dashboard.service'

export function LineChartWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  if (!data.series.some((series) => series.points.length))
    return <p className="text-sm text-slate-500">No data available</p>
  return <p className="text-sm text-slate-600">This dashboard source does not use a line chart.</p>
}
