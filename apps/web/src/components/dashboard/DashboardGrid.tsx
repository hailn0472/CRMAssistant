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

// The grid is one column below `sm`, two columns from `sm` to `xl`, and four
// columns at `xl`. Keep the base column span at one so a wide widget cannot
// create implicit columns on narrow viewports. Every responsive class is kept
// literal for Tailwind's scanner.
const RESPONSIVE_SPAN_CLASS: Record<string, string> = {
  'col-span-1 row-span-1': 'col-span-1 row-span-1 min-w-0',
  'col-span-2 row-span-1': 'col-span-1 row-span-1 min-w-0 sm:col-span-2 xl:col-span-2',
  'col-span-2 row-span-2': 'col-span-1 row-span-2 min-w-0 sm:col-span-2 xl:col-span-2',
  'col-span-3 row-span-2': 'col-span-1 row-span-2 min-w-0 sm:col-span-2 xl:col-span-3',
}

function resolveResponsiveSpan(span: WidgetSpan): WidgetSpan {
  return {
    ...span,
    className:
      RESPONSIVE_SPAN_CLASS[span.className] ?? RESPONSIVE_SPAN_CLASS['col-span-1 row-span-1'],
  }
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
    () =>
      widgets.map((w) => ({
        widget: w,
        span: resolveResponsiveSpan(resolveWidgetSpan(w.size, 4)),
      })),
    [widgets],
  )

  return (
    <section
      className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4 xl:p-6"
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
