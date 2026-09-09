'use client'

import { lazy, Suspense } from 'react'

import { CardSkeleton } from '@/components/shared'
import type { WidgetData, WidgetResultData } from '@/services/dashboard.service'

// React.lazy + Suspense keeps recharts out of the initial bundle
// when a dashboard may have only metric cards.
const MetricCardWidget = lazy(() =>
  import('./widgets/MetricCardWidget').then((m) => ({ default: m.MetricCardWidget })),
)
const LineChartWidget = lazy(() =>
  import('./widgets/LineChartWidget').then((m) => ({ default: m.LineChartWidget })),
)
const BarChartWidget = lazy(() =>
  import('./widgets/BarChartWidget').then((m) => ({ default: m.BarChartWidget })),
)
const PieChartWidget = lazy(() =>
  import('./widgets/PieChartWidget').then((m) => ({ default: m.PieChartWidget })),
)
const FunnelWidget = lazy(() =>
  import('./widgets/FunnelWidget').then((m) => ({ default: m.FunnelWidget })),
)
const TableWidget = lazy(() =>
  import('./widgets/TableWidget').then((m) => ({ default: m.TableWidget })),
)
const ActivityFeedWidget = lazy(() =>
  import('./widgets/ActivityFeedWidget').then((m) => ({ default: m.ActivityFeedWidget })),
)
const TaskListWidget = lazy(() =>
  import('./widgets/TaskListWidget').then((m) => ({ default: m.TaskListWidget })),
)

interface WidgetRendererProps {
  widget: WidgetData
  data: WidgetResultData
}

/**
 * WidgetRenderer — switch over WidgetType to the correct renderer component.
 * An exhaustive switch over the const tuple — a new type is a compile error.
 */
export function WidgetRenderer({ widget, data }: WidgetRendererProps): React.JSX.Element {
  const fallback = <CardSkeleton />

  switch (widget.type) {
    case 'METRIC_CARD':
      return (
        <Suspense fallback={fallback}>
          <MetricCardWidget data={data} />
        </Suspense>
      )
    case 'LINE_CHART':
      return (
        <Suspense fallback={fallback}>
          <LineChartWidget data={data} />
        </Suspense>
      )
    case 'BAR_CHART':
      return (
        <Suspense fallback={fallback}>
          <BarChartWidget data={data} />
        </Suspense>
      )
    case 'PIE_CHART':
      return (
        <Suspense fallback={fallback}>
          <PieChartWidget data={data} />
        </Suspense>
      )
    case 'FUNNEL':
      return (
        <Suspense fallback={fallback}>
          <FunnelWidget data={data} />
        </Suspense>
      )
    case 'TABLE':
      return (
        <Suspense fallback={fallback}>
          <TableWidget data={data} />
        </Suspense>
      )
    case 'ACTIVITY_FEED':
      return (
        <Suspense fallback={fallback}>
          <ActivityFeedWidget data={data} />
        </Suspense>
      )
    case 'TASK_LIST':
      return (
        <Suspense fallback={fallback}>
          <TaskListWidget data={data} />
        </Suspense>
      )
    default: {
      const _exhaustive: never = widget.type
      throw new Error(`Unknown widget type: ${_exhaustive as string}`)
    }
  }
}
