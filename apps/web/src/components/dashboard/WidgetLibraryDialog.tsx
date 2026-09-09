'use client'

import { useState } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { addWidget } from '@/services/dashboard.service'
import { useMyPermissions } from '@/hooks/usePermission'
import {
  WIDGET_SOURCES,
  WIDGET_TYPES,
  WIDGET_SOURCE_PERMISSIONS,
  WIDGET_SOURCE_DESCRIPTIONS,
} from '@/lib/widget-format'
import {
  X,
  BarChart3,
  LineChart,
  PieChart,
  Table2,
  Activity,
  CheckSquare,
  Filter,
  Hash,
} from 'lucide-react'

interface WidgetLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dashboardId: string
}

/**
 * WIDGET_SOURCES_ALLOWED_TYPES — which widget types each source supports.
 * Mirrors apps/api/src/dashboards/widget-types.ts WIDGET_SOURCES.
 */
const SOURCE_ALLOWED_TYPES: Record<string, string[]> = {
  MY_TASKS: ['TASK_LIST'],
  TASK_STATS: ['METRIC_CARD'],
  RECENT_ACTIVITY: ['ACTIVITY_FEED'],
  CONTACT_COUNT: ['METRIC_CARD'],
  LEAD_FUNNEL: ['BAR_CHART', 'PIE_CHART', 'FUNNEL'],
}

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  METRIC_CARD: Hash,
  LINE_CHART: LineChart,
  BAR_CHART: BarChart3,
  PIE_CHART: PieChart,
  FUNNEL: Filter,
  TABLE: Table2,
  ACTIVITY_FEED: Activity,
  TASK_LIST: CheckSquare,
}

// Static illustrative preview — a fixed CSS sketch (never live data), so the
// picker conveys what each source looks like without an extra round-trip (AC 79).
const PREVIEW_BARS = ['h-6', 'h-10', 'h-4', 'h-8', 'h-5']

function SourcePreview({ source }: { source: string }): React.JSX.Element {
  if (source === 'LEAD_FUNNEL') {
    return (
      <div className="flex h-12 items-end gap-1" aria-hidden="true">
        {PREVIEW_BARS.map((h, i) => (
          <span key={i} className={`w-3 rounded-sm bg-indigo-200 ${h}`} />
        ))}
      </div>
    )
  }
  // Metric-card / list sources — a couple of neutral lines suggest a readout.
  return (
    <div className="flex h-12 flex-col justify-center gap-1.5" aria-hidden="true">
      <span className="h-2 w-20 rounded bg-indigo-200" />
      <span className="h-1.5 w-16 rounded bg-slate-200" />
      <span className="h-1.5 w-14 rounded bg-slate-200" />
    </div>
  )
}

/**
 * WidgetLibraryDialog — "Add widget" picker.
 *
 * Lists every (source, type) pair from WIDGET_SOURCES with allowed types,
 * each with a static illustrative preview and a source description (AC 79).
 * Sources the caller lacks permission for are HIDDEN, not disabled (AC 79).
 * Submits addWidget mutation.
 */
export function WidgetLibraryDialog({
  open,
  onOpenChange,
  dashboardId,
}: WidgetLibraryDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const { hasPermission } = useMyPermissions()
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<string | null>(null)

  const addWidgetMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSource || !selectedType) return
      const source = selectedSource
      const type = selectedType
      const title = WIDGET_SOURCES[source] ?? source
      await addWidget(dashboardId, {
        type,
        source,
        title,
        config: { source, dateRangeDays: 30, stageId: null, ownerId: null, limit: 5 },
        size: type === 'METRIC_CARD' ? '1x1' : '2x2',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', dashboardId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'my'] })
      toast.success('Widget added')
      onOpenChange(false)
      setSelectedSource(null)
      setSelectedType(null)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add widget')
    },
  })

  const isSourceSelected = (source: string): boolean => selectedSource === source
  const isTypeSelected = (source: string, type: string): boolean =>
    selectedSource === source && selectedType === type

  const handleAdd = (): void => {
    addWidgetMutation.mutate()
  }

  const handleCancel = (): void => {
    onOpenChange(false)
    setSelectedSource(null)
    setSelectedType(null)
  }

  // Hide sources the caller lacks permission for (AC 79).
  const sourceEntries = Object.entries(WIDGET_SOURCES).filter(([sourceKey]) => {
    const perm = WIDGET_SOURCE_PERMISSIONS[sourceKey]
    if (!perm) return true
    return hasPermission(perm.resource, perm.action)
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Add Widget</DialogTitle>
          <button
            type="button"
            onClick={handleCancel}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <p className="mb-4 text-sm text-slate-500">
          Select a data source and a widget type to add it to your dashboard.
        </p>

        <div className="max-h-[400px] space-y-3 overflow-y-auto">
          {sourceEntries.map(([sourceKey, sourceLabel]) => {
            const allowedTypes = SOURCE_ALLOWED_TYPES[sourceKey] ?? []
            if (allowedTypes.length === 0) return null

            const sourceSelected = isSourceSelected(sourceKey)

            return (
              <div
                key={sourceKey}
                className={`rounded-lg border p-3 transition-colors ${
                  sourceSelected
                    ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => {
                    setSelectedSource(sourceKey)
                    setSelectedType(null)
                  }}
                  aria-expanded={sourceSelected}
                  aria-label={`Select source ${sourceLabel}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{sourceLabel}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {WIDGET_SOURCE_DESCRIPTIONS[sourceKey] ?? ''}
                      </p>
                    </div>
                    <SourcePreview source={sourceKey} />
                  </div>
                </button>

                {sourceSelected && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {allowedTypes.map((type) => {
                      const Icon = TYPE_ICON[type] ?? Hash
                      const typeLabel = WIDGET_TYPES[type] ?? type
                      const typeSelected = isTypeSelected(sourceKey, type)

                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            setSelectedType(type)
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            typeSelected
                              ? 'border-indigo-300 bg-indigo-100 text-indigo-700'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                          }`}
                          aria-pressed={typeSelected}
                          aria-label={`Select ${typeLabel} for ${sourceLabel}`}
                        >
                          <Icon className="h-3 w-3" />
                          {typeLabel}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancel}
            disabled={addWidgetMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!selectedSource || !selectedType || addWidgetMutation.isPending}
          >
            {addWidgetMutation.isPending ? 'Adding...' : 'Add Widget'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
