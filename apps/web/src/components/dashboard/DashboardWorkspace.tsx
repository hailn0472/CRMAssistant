'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { PenLine, Check, Plus, Share2 } from 'lucide-react'
import toast from 'react-hot-toast'

import {
  fetchMyDashboard,
  fetchDashboard,
  fetchDashboards,
  reorderWidgets,
  updateWidget,
} from '@/services/dashboard.service'
import type { WidgetData } from '@/services/dashboard.service'
import { DashboardGrid } from './DashboardGrid'
import { WidgetFrame } from './WidgetFrame'
import { WidgetRenderer } from './WidgetRenderer'
import type { SortableHandleProps } from './SortableWidget'
import { DashboardSwitcher } from './DashboardSwitcher'
import { WidgetLibraryDialog } from './WidgetLibraryDialog'
import { ShareDashboardDialog } from './ShareDashboardDialog'
import { resolveWidgetReorder } from '@/lib/widget-format'
import { DashboardSkeleton, ErrorState, EmptyState } from '@/components/shared'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/stores/auth.store'

/**
 * DashboardWorkspace — main dashboard shell with DnD editing.
 *
 * Owns: URL-based dashboard selection, edit-mode toggle, DndContext + SortableContext,
 * optimistic reorder/resize, polling (paused in edit mode), and read-only mode for
 * dashboards shared with the caller (AC 72).
 */
export function DashboardWorkspace(): React.JSX.Element {
  const searchParams = useSearchParams()
  const dashboardId = searchParams.get('dashboard')
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const [isEditing, setIsEditing] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareTargetId, setShareTargetId] = useState<string | null>(null)

  const openShareFor = (id: string): void => {
    setShareTargetId(id)
    setShareOpen(true)
  }

  // Fetch active dashboard
  const {
    data: dashboard,
    isLoading: dashLoading,
    isError: dashError,
    error: dashErr,
    refetch: refetchDash,
  } = useQuery({
    queryKey: dashboardId ? ['dashboard', dashboardId] : ['dashboard', 'my'],
    queryFn: () => (dashboardId ? fetchDashboard(dashboardId) : fetchMyDashboard()),
    refetchInterval: isEditing ? false : 30_000,
  })

  // Fetch dashboard list for switcher
  const { data: dashList } = useQuery({
    queryKey: ['dashboards'],
    queryFn: fetchDashboards,
  })

  // Read-only when the active dashboard is owned by someone else (AC 72).
  // A shared dashboard shows no edit toggle, no drag handles and no widget menu.
  const isReadOnly =
    Boolean(currentUser) && Boolean(dashboard) && dashboard!.userId !== currentUser!.userId
  const ownerName = isReadOnly ? dashboard!.ownerName ?? null : null
  const effectiveEditing = isEditing && !isReadOnly

  const widgets: WidgetData[] = (dashboard?.widgets as WidgetData[] | undefined) ?? []
  const sorted = [...widgets].sort((a, b) => a.position - b.position)
  const widgetIds = sorted.map((w) => w.id)

  // Reorder mutation (optimistic)
  const reorderMutation = useMutation({
    mutationFn: ({ orderedIds }: { orderedIds: string[] }) =>
      reorderWidgets(dashboard!.id, orderedIds),
    onMutate: async ({ orderedIds }) => {
      const key = dashboardId ? ['dashboard', dashboardId] : ['dashboard', 'my']
      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData(key)
      // Optimistically reorder
      queryClient.setQueryData(key, (old: unknown) => {
        if (!old || typeof old !== 'object') return old
        const d = { ...(old as Record<string, unknown>) }
        const ws = [...(d['widgets'] as WidgetData[])]
        const ordered = orderedIds
          .map((id, idx) => {
            const w = ws.find((x) => x.id === id)
            return w ? { ...w, position: idx } : null
          })
          .filter(Boolean) as WidgetData[]
        d['widgets'] = ordered
        return d
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      const key = dashboardId ? ['dashboard', dashboardId] : ['dashboard', 'my']
      if (context?.prev) queryClient.setQueryData(key, context.prev)
      toast.error('Failed to reorder widgets. Please try again.')
    },
    onSettled: () => {
      const key = dashboardId ? ['dashboard', dashboardId] : ['dashboard', 'my']
      queryClient.invalidateQueries({ queryKey: key })
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
    },
  })

  // Resize mutation (optimistic)
  const resizeMutation = useMutation({
    mutationFn: ({ widgetId, size }: { widgetId: string; size: string }) =>
      updateWidget(widgetId, { size }),
    onMutate: async ({ widgetId, size }) => {
      const key = dashboardId ? ['dashboard', dashboardId] : ['dashboard', 'my']
      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData(key)
      queryClient.setQueryData(key, (old: unknown) => {
        if (!old || typeof old !== 'object') return old
        const d = { ...(old as Record<string, unknown>) }
        const ws = ((d['widgets'] as WidgetData[]) ?? []).map((w) =>
          w.id === widgetId ? { ...w, size } : w,
        )
        d['widgets'] = ws
        return d
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      const key = dashboardId ? ['dashboard', dashboardId] : ['dashboard', 'my']
      if (context?.prev) queryClient.setQueryData(key, context.prev)
      toast.error('Failed to resize widget. Please try again.')
    },
    onSettled: () => {
      const key = dashboardId ? ['dashboard', dashboardId] : ['dashboard', 'my']
      queryClient.invalidateQueries({ queryKey: key })
    },
  })

  // Sensors — copied from PipelineBoard.tsx:262-266
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  )

  const handleDragStart = (event: DragStartEvent): void => {
    if (isReadOnly) return
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveId(null)
    if (isReadOnly) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const newOrder = resolveWidgetReorder(widgetIds, active.id as string, over.id as string)
    if (newOrder !== widgetIds) {
      reorderMutation.mutate({ orderedIds: newOrder })
    }
  }

  const handleMoveUp = (widgetId: string): void => {
    const idx = widgetIds.indexOf(widgetId)
    if (idx <= 0) return
    const newOrder = [...widgetIds]
    newOrder.splice(idx, 1)
    newOrder.splice(idx - 1, 0, widgetId)
    reorderMutation.mutate({ orderedIds: newOrder })
  }

  const handleMoveDown = (widgetId: string): void => {
    const idx = widgetIds.indexOf(widgetId)
    if (idx === -1 || idx >= widgetIds.length - 1) return
    const newOrder = [...widgetIds]
    newOrder.splice(idx, 1)
    newOrder.splice(idx + 1, 0, widgetId)
    reorderMutation.mutate({ orderedIds: newOrder })
  }

  const handleResize = (widgetId: string, size: string): void => {
    resizeMutation.mutate({ widgetId, size })
  }

  if (dashLoading) return <DashboardSkeleton />

  if (dashError) {
    return (
      <ErrorState
        title="Could not load dashboard"
        message={dashErr instanceof Error ? dashErr.message : 'An unexpected error occurred.'}
        onRetry={() => refetchDash()}
      />
    )
  }

  if (!dashboard) {
    return (
      <EmptyState
        title="No dashboard found"
        description="Your dashboard could not be loaded. Please try refreshing the page."
      />
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <DashboardSwitcher currentDashboardId={dashboard.id} onShareDashboard={openShareFor} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-slate-950">{dashboard.name}</h1>
                {isReadOnly && (
                  <Badge variant="neutral" className="text-xs">
                    {ownerName ? `Shared by ${ownerName} · Read only` : 'Shared · Read only'}
                  </Badge>
                )}
              </div>
              {dashList && (
                <p className="text-xs text-slate-500">
                  {dashList.owned.length + dashList.sharedWithMe.length} dashboard
                  {dashList.owned.length + dashList.sharedWithMe.length !== 1 ? 's' : ''} available
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isReadOnly && (
              <>
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  aria-label="Add widget"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Add widget</span>
                </button>
                <button
                  type="button"
                  onClick={() => openShareFor(dashboard.id)}
                  className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex"
                  aria-label="Share dashboard"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </button>
                {/* Edit toggle is hidden on mobile (AC 84) — the mobile grid is
                    read-only (ux-design-specification.md:2165-2171). */}
                <button
                  type="button"
                  onClick={() => setIsEditing((prev) => !prev)}
                  className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex"
                  aria-label={isEditing ? 'Done editing' : 'Edit dashboard'}
                >
                  {isEditing ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Done
                    </>
                  ) : (
                    <>
                      <PenLine className="h-3.5 w-3.5" />
                      Edit
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* DnD Grid */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up widget ${active.id}`,
            onDragOver: ({ active, over }) =>
              over
                ? `Widget ${active.id} is over widget ${over.id}`
                : `Widget ${active.id} is not over a target`,
            onDragEnd: ({ active, over }) =>
              over
                ? `Dropped widget ${active.id} after widget ${over.id}`
                : `Widget ${active.id} was dropped`,
            onDragCancel: ({ active }) => `Dragging cancelled. Widget ${active.id} was returned.`,
          },
        }}
      >
        <SortableContext items={widgetIds} strategy={rectSortingStrategy}>
          <DashboardGrid widgets={sorted} isEditing={effectiveEditing}>
            {(widget, _span, dragHandle) => (
              <WidgetDataProvider
                widget={widget}
                dragHandle={dragHandle}
                isEditing={effectiveEditing}
                isReadOnly={isReadOnly}
                dashboardId={dashboard.id}
                onMoveUp={() => handleMoveUp(widget.id)}
                onMoveDown={() => handleMoveDown(widget.id)}
                onResize={(size: string) => handleResize(widget.id, size)}
              />
            )}
          </DashboardGrid>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeId ? (
            <div className="motion-safe:transition-transform rounded-lg border-2 border-indigo-300 bg-white/95 p-4 shadow-lg opacity-90">
              <p className="text-sm font-medium text-slate-700">
                {sorted.find((w) => w.id === activeId)?.title ?? 'Widget'}
              </p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      <WidgetLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        dashboardId={dashboard.id}
      />
      <ShareDashboardDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        dashboardId={shareTargetId ?? dashboard.id}
      />
    </div>
  )
}

/** Per-widget data fetcher */
function WidgetDataProvider({
  widget,
  dragHandle,
  isEditing,
  isReadOnly,
  dashboardId,
  onMoveUp,
  onMoveDown,
  onResize,
}: {
  widget: WidgetData
  dragHandle?: SortableHandleProps | null
  isEditing: boolean
  isReadOnly: boolean
  dashboardId: string
  onMoveUp?: () => void
  onMoveDown?: () => void
  onResize?: (size: string) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['widgetData', widget.id],
    queryFn: async () => {
      const { fetchWidgetData } = await import('@/services/dashboard.service')
      return fetchWidgetData(widget.id)
    },
    refetchInterval: isEditing ? false : 30_000,
  })

  const removeMutation = useMutation({
    mutationFn: async (widgetId: string) => {
      const { removeWidget } = await import('@/services/dashboard.service')
      return removeWidget(widgetId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', dashboardId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'my'] })
      toast.success('Widget removed')
    },
    onError: () => {
      toast.error('Failed to remove widget. Please try again.')
    },
  })

  return (
    <WidgetFrame
      widget={widget}
      isLoading={isLoading}
      isError={isError}
      isPermissionLimited={data?.permissionLimited ?? false}
      isReadOnly={isReadOnly}
      isEditing={isEditing}
      dragHandleProps={dragHandle ?? undefined}
      onRetry={() => refetch()}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onResize={onResize}
      onRemove={() => removeMutation.mutate(widget.id)}
    >
      {data && !isLoading && !isError && <WidgetRenderer widget={widget} data={data} />}
    </WidgetFrame>
  )
}
