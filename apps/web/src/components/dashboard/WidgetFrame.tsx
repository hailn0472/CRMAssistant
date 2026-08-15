'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MoreHorizontal, GripVertical } from 'lucide-react'
import { CardSkeleton, ErrorState, PermissionLimitedState } from '@/components/shared'

import type { SortableHandleProps } from './SortableWidget'
import type { WidgetData } from '@/services/dashboard.service'

interface WidgetFrameProps {
  widget: WidgetData
  isLoading?: boolean
  isError?: boolean
  errorMessage?: string
  isPermissionLimited?: boolean
  isReadOnly?: boolean
  isEditing?: boolean
  /** Drag-handle props from useSortable — attached to the grip (AC 67). */
  dragHandleProps?: SortableHandleProps
  onRetry?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onResize?: (size: string) => void
  onRemove?: () => void
  children?: React.ReactNode
}

/**
 * WidgetFrame — the stable chrome every widget lives in.
 *
 * States: loading → CardSkeleton, error → ErrorState, empty/permissionLimited,
 * normal → children. One widget's failure never blanks the page.
 */
export function WidgetFrame({
  widget,
  isLoading,
  isError,
  errorMessage,
  isPermissionLimited,
  isReadOnly,
  isEditing,
  dragHandleProps,
  onRetry,
  onMoveUp,
  onMoveDown,
  onResize,
  onRemove,
  children,
}: WidgetFrameProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const toggleMenu = useCallback(() => {
    setConfirmRemove(false)
    setMenuOpen((prev) => !prev)
  }, [])
  const closeMenuAnd = useCallback((fn?: () => void) => {
    setMenuOpen(false)
    setConfirmRemove(false)
    fn?.()
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setConfirmRemove(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  if (isLoading) {
    return <CardSkeleton />
  }

  if (isError) {
    return (
      <ErrorState
        title="Could not load widget data"
        message={errorMessage ?? 'An unexpected error occurred. Please try again.'}
        onRetry={onRetry}
      />
    )
  }

  if (isPermissionLimited) {
    return (
      <PermissionLimitedState
        title={`${widget.title} unavailable`}
        message="You do not have permission to view this widget's data. Contact your administrator for access."
      />
    )
  }

  return (
    <Card
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
      aria-labelledby={`widget-title-${widget.id}`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          {isEditing &&
            (dragHandleProps ? (
              <button
                type="button"
                {...dragHandleProps.attributes}
                {...dragHandleProps.listeners}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 cursor-grab active:cursor-grabbing hover:bg-slate-100 focus:outline-none"
                aria-label={`Drag ${widget.title}`}
              >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <GripVertical
                className="h-4 w-4 text-slate-400 cursor-grab active:cursor-grabbing"
                aria-hidden="true"
              />
            ))}
          <CardTitle id={`widget-title-${widget.id}`} className="text-sm font-medium">
            {widget.title}
          </CardTitle>
        </div>
        <div className="relative flex items-center gap-1" ref={menuRef}>
          {!isReadOnly && isEditing && (
            <>
              <button
                type="button"
                onClick={toggleMenu}
                className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none"
                aria-label={`Widget actions for ${widget.title}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Widget actions
                  </div>
                  {/* Move/Resize are hidden below 640px (AC 84): a 1-column
                      grid has no meaningful reordering/resize, and heavy
                      manipulation is an explicit mobile non-priority
                      (ux-design-specification.md:2165-2171). Remove stays. */}
                  <button
                    type="button"
                    onClick={() => closeMenuAnd(onMoveUp)}
                    className="hidden w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 sm:flex"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => closeMenuAnd(onMoveDown)}
                    className="hidden w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 sm:flex"
                  >
                    Move down
                  </button>
                  <div className="my-1 hidden border-t border-slate-100 sm:block" />
                  <button
                    type="button"
                    onClick={() => closeMenuAnd(() => onResize?.('1x1'))}
                    className="hidden w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 sm:flex"
                  >
                    Resize to Small (1&times;1)
                  </button>
                  <button
                    type="button"
                    onClick={() => closeMenuAnd(() => onResize?.('2x1'))}
                    className="hidden w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 sm:flex"
                  >
                    Resize to Wide (2&times;1)
                  </button>
                  <button
                    type="button"
                    onClick={() => closeMenuAnd(() => onResize?.('2x2'))}
                    className="hidden w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 sm:flex"
                  >
                    Resize to Medium (2&times;2)
                  </button>
                  <button
                    type="button"
                    onClick={() => closeMenuAnd(() => onResize?.('3x2'))}
                    className="hidden w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 sm:flex"
                  >
                    Resize to Large (3&times;2)
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  {confirmRemove ? (
                    <div className="px-3 py-1.5">
                      <p className="mb-1.5 text-xs text-slate-600">Remove this widget?</p>
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(false)}
                          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => closeMenuAnd(onRemove)}
                          className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(true)}
                      className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50"
                    >
                      Remove widget
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children ?? null}</CardContent>
    </Card>
  )
}
