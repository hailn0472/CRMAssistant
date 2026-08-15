'use client'

import { useMemo } from 'react'

import { resolveWidgetSpan } from '@/lib/widget-format'
import { SortableWidget } from './SortableWidget'
import type { SortableHandleProps } from './SortableWidget'
import type { WidgetData } from '@/services/dashboard.service'

export interface WidgetSpan {
  colSpan: number
  rowSpan: number
  className: string
}

interface DashboardGridProps {
  widgets: WidgetData[]
  /** Effective edit mode — when true, cells register as sortable nodes (AC 67). */
  isEditing?: boolean
  children: (
    widget: WidgetData,
    span: WidgetSpan,
    dragHandle: SortableHandleProps | null,
  ) => React.ReactNode
}

/**
 * DashboardGrid — Tailwind CSS Grid, responsive 4→2→1 columns.
 * Spans derived from resolveWidgetSpan. No layout library.
 */
export function DashboardGrid({
  widgets,
  isEditing = false,
  children,
}: DashboardGridProps): React.JSX.Element {
  const spans = useMemo(
    () => widgets.map((w) => ({ widget: w, span: resolveWidgetSpan(w.size, 4) })),
    [widgets],
  )

  return (
    <section
      className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 auto-rows-[minmax(160px,auto)] gap-4 p-4"
      aria-label="Dashboard widgets"
    >
      {spans.map(({ widget, span }) =>
        isEditing ? (
          <SortableWidget key={widget.id} widgetId={widget.id} className={span.className}>
            {(handle) => children(widget, span, handle)}
          </SortableWidget>
        ) : (
          <div key={widget.id} className={span.className}>
            {children(widget, span, null)}
          </div>
        ),
      )}
    </section>
  )
}
