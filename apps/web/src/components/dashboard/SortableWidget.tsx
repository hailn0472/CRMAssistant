'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'

/** Drag-handle props threaded from useSortable to the grip in WidgetFrame. */
export interface SortableHandleProps {
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
}

interface SortableWidgetProps {
  widgetId: string
  className: string
  children: (handle: SortableHandleProps) => React.ReactNode
}

/**
 * SortableWidget — the sortable node inside SortableContext (AC 67).
 *
 * setNodeRef goes on the grid cell so rectSortingStrategy measures the cell
 * (not the card inside it). listeners + attributes are handed to the child so
 * WidgetFrame can attach them to the drag handle. While dragging, the source
 * cell is `visibility: hidden` and DragOverlay renders the clone
 * (DealCard.tsx:80-86 precedent).
 */
export function SortableWidget({
  widgetId,
  className,
  children,
}: SortableWidgetProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widgetId,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Hidden but layout space is preserved — DragOverlay handles the visual.
    visibility: isDragging ? 'hidden' : 'visible',
  }

  return (
    <div ref={setNodeRef} className={className} style={style}>
      {children({ attributes, listeners })}
    </div>
  )
}
