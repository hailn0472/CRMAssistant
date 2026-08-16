'use client'

/**
 * Story 6.3 — /reports/builder orchestrator (AC 3-4, 10-11, 15-16, D.23-29).
 *
 * Thin App Router page renders this component. It owns the local draft
 * reducer, the ['customReports']-rooted TanStack server state (catalogue,
 * preview, saved report), the 300 ms debounced/cancelled preview flow that
 * never requests invalid drafts, permission gating (REPORT:READ + selected
 * source read; save only with REPORT CREATE/UPDATE — no fake disabled
 * mutation affordance) and the React Hook Form + Zod save dialog with query
 * invalidation and URL transition to edit mode.
 */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { RotateCcw, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { usePermission } from '@/hooks/usePermission'
import {
  getCustomReportData,
  getCustomReportFieldCatalog,
  previewCustomReport,
  saveCustomReport,
} from '@/services/custom-report.service'
import type {
  CustomReportAggregation,
  CustomReportCalculatedField,
  CustomReportConfig,
  CustomReportDataSource,
  CustomReportFilter,
  CustomReportGranularity,
  CustomReportSort,
  CustomReportSortDirection,
  CustomReportVisualization,
} from '@/lib/custom-report-builder'
import {
  createEmptyDraft,
  customReportDraftReducer,
  serializeConfig,
  validateDraft,
} from '@/lib/custom-report-builder'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { ErrorState } from '@/components/shared/ErrorState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { CustomReportDataSourcePanel } from './CustomReportDataSourcePanel'
import { CustomReportFieldsPanel } from './CustomReportFieldsPanel'
import { CustomReportVisualizationPanel } from './CustomReportVisualizationPanel'
import { CustomReportPreview } from './CustomReportPreview'

const PREVIEW_DEBOUNCE_MS = 300

const saveSchema = z.object({
  name: z.string().trim().min(1, 'Report name is required').max(120, 'Report name is too long'),
  isPublic: z.boolean(),
})

type SaveFormValues = z.infer<typeof saveSchema>

function SaveCustomReportDialog({
  open,
  isEditing,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  isEditing: boolean
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: SaveFormValues) => void
}): React.JSX.Element | null {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SaveFormValues>({
    resolver: zodResolver(saveSchema),
    defaultValues: { name: '', isPublic: false },
  })
  const isPublic = watch('isPublic')

  useEffect(() => {
    if (open) reset({ name: '', isPublic: false })
  }, [open, reset])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-report-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="w-full max-w-[420px] rounded-[14px] bg-white p-5 shadow-lg"
      >
        <h3 id="save-report-title" className="text-[16px] font-semibold text-[#1b1b1f]">
          {isEditing ? 'Save changes' : 'Save custom report'}
        </h3>
        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Report name</span>
          <input
            type="text"
            aria-label="Report name"
            placeholder="e.g. Revenue by stage"
            {...register('name')}
            className="h-9 rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[13px] outline-none focus:border-[#1b1b1f]"
          />
          {errors.name ? (
            <span role="alert" className="text-[11.5px] text-[#dc2626]">
              {errors.name.message}
            </span>
          ) : null}
        </label>
        <label className="mt-3 flex min-h-[34px] cursor-pointer items-center justify-between gap-2.5">
          <span className="text-[12.5px] text-[#4b4b55]">Visible to my team</span>
          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            aria-label="Make report public"
            onClick={() => setValue('isPublic', !isPublic, { shouldValidate: true })}
            className={`relative h-5 w-9 flex-none rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f] ${
              isPublic ? 'bg-[#1b1b1f]' : 'bg-[#cbd5e1]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                isPublic ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </button>
          <input type="hidden" {...register('isPublic')} />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex min-h-[44px] items-center rounded-[9px] border border-[#e6e6eb] bg-white px-4 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[9px] bg-[#1b1b1f] px-4 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
          >
            {isEditing ? 'Save changes' : 'Create report'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function CustomReportBuilder(): React.JSX.Element {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const reportId = searchParams.get('reportId')

  // ─── Permissions (Contract D.31) ─────────────────────────────────────
  const canReadReport = usePermission('REPORT', 'READ')
  const canReadContacts = usePermission('CONTACT', 'READ')
  const canReadDeals = usePermission('DEAL', 'READ')
  const canReadTasks = usePermission('TASK', 'READ')
  const canCreateReport = usePermission('REPORT', 'CREATE')
  const canUpdateReport = usePermission('REPORT', 'UPDATE')
  const hasAnySourceRead = canReadContacts || canReadDeals || canReadTasks
  const canReadSource = useCallback(
    (source: CustomReportDataSource): boolean => {
      if (source === 'CONTACTS') return canReadContacts
      if (source === 'DEALS') return canReadDeals
      if (source === 'TASKS') return canReadTasks
      return canReadContacts // ACTIVITIES visibility derives from its active parent Contact
    },
    [canReadContacts, canReadDeals, canReadTasks],
  )

  // ─── Draft state (local, Contract D.27) ──────────────────────────────
  const [draft, dispatch] = useReducer(customReportDraftReducer, undefined, createEmptyDraft)
  const [seeded, setSeeded] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<'source' | 'fields' | 'viz'>('source')

  // ─── Edit mode (Contract D.23): load the saved typed config ──────────
  const editQuery = useQuery({
    queryKey: ['customReports', 'report', reportId],
    queryFn: () => getCustomReportData(reportId as string),
    enabled: !!reportId && canReadReport && hasAnySourceRead,
  })

  useEffect(() => {
    if (reportId && editQuery.data && !seeded) {
      dispatch({ type: 'LOAD_CONFIG', config: editQuery.data.config })
      setSeeded(true)
    }
  }, [reportId, editQuery.data, seeded])

  // ─── Catalogue (server-owned source of truth, Contract B.11) ─────────
  const catalogQuery = useQuery({
    queryKey: ['customReports', 'catalog', draft.source],
    queryFn: () => getCustomReportFieldCatalog(draft.source as CustomReportDataSource),
    enabled: !!draft.source && canReadReport && canReadSource(draft.source),
  })

  // ─── Validation + serialization (server-equivalent gating, AC 15) ────
  const validation = useMemo(
    () => validateDraft(draft, catalogQuery.data ?? null),
    [draft, catalogQuery.data],
  )
  const config = useMemo(() => serializeConfig(draft), [draft])

  // ─── Debounced preview config (Contract D.27, E6) ────────────────────
  const [previewConfig, setPreviewConfig] = useState<CustomReportConfig | null>(null)
  useEffect(() => {
    if (!config || !validation.previewable) {
      setPreviewConfig(null)
      return
    }
    const timer = setTimeout(() => {
      setPreviewConfig(config)
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      // Superseded in-flight previews are cancelled when the config changes.
      queryClient.cancelQueries({ queryKey: ['customReports', 'preview'] })
    }
  }, [config, validation.previewable, queryClient])

  const previewQuery = useQuery({
    queryKey: ['customReports', 'preview', previewConfig],
    queryFn: () => previewCustomReport(previewConfig as CustomReportConfig),
    enabled: !!previewConfig && canReadReport && !!draft.source && canReadSource(draft.source),
    // Preserve the last successful preview while refreshing.
    placeholderData: (previous) => previous,
  })

  // ─── Save (AC 11, 16, Contract D.29) ─────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (input: {
      reportId?: string
      name: string
      config: CustomReportConfig
      isPublic?: boolean
    }) => saveCustomReport(input),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['customReports'] })
      queryClient.invalidateQueries({ queryKey: ['salesReports', 'list'] })
      toast.success(reportId ? 'Report updated' : 'Report created')
      setSaveOpen(false)
      dispatch({ type: 'LOAD_CONFIG', config: saved.config })
      setSeeded(true)
      if (!reportId) {
        // Newly created report transitions to edit mode with a stable URL.
        router.replace(`/reports/builder?reportId=${saved.id}`)
      }
    },
    onError: (error: Error) => {
      toast.error(error?.message ?? 'Could not save the report')
    },
  })

  const canSave =
    validation.saveable &&
    !!config &&
    (reportId ? canUpdateReport : canCreateReport) &&
    !!draft.source &&
    canReadSource(draft.source)
  const showSaveButton = reportId ? canUpdateReport : canCreateReport

  // ─── Panel handlers (thin dispatch wrappers) ─────────────────────────
  const handleSourceChange = (source: CustomReportDataSource): void => {
    dispatch({ type: 'SET_SOURCE', source })
    dispatch({ type: 'CLEAR_SELECTIONS' })
  }
  const handleAddDimension = (fieldId: string): void => {
    dispatch({ type: 'ADD_DIMENSION', fieldId })
  }
  const handleAddMetric = (fieldId: string, aggregation?: CustomReportAggregation): void => {
    dispatch({ type: 'ADD_METRIC', fieldId, aggregation })
  }
  const handleAddCountMetric = (): void => {
    const countField = (catalogQuery.data?.fields ?? []).find(
      (f) => f.key === `${draft.source?.toLowerCase()}.id` && f.roles.includes('METRIC'),
    )
    if (countField) dispatch({ type: 'ADD_METRIC', fieldId: countField.key, aggregation: 'COUNT' })
  }
  const handleRemoveItem = (role: 'dimension' | 'metric', id: string): void => {
    dispatch({ type: 'REMOVE_ITEM', role, id })
  }
  const handleMoveItem = (
    role: 'dimension' | 'metric',
    id: string,
    direction: 'up' | 'down',
  ): void => {
    dispatch({ type: 'MOVE_ITEM', role, id, direction })
  }
  const handleSetAggregation = (metricId: string, aggregation: CustomReportAggregation): void => {
    dispatch({ type: 'SET_AGGREGATION', metricId, aggregation })
  }
  const handleSetGranularity = (
    dimensionId: string,
    granularity: CustomReportGranularity | null,
  ): void => {
    dispatch({ type: 'SET_GRANULARITY', dimensionId, granularity })
  }
  const handleAddCalculatedField = (field: CustomReportCalculatedField): void => {
    dispatch({ type: 'ADD_CALCULATED_FIELD', field })
  }
  const handleRemoveCalculatedField = (id: string): void => {
    dispatch({ type: 'REMOVE_CALCULATED_FIELD', id })
  }
  const handleReorderItems = (role: 'dimension' | 'metric', orderedIds: string[]): void => {
    dispatch({ type: 'REORDER_ITEMS', role, orderedIds })
  }
  const handleAddSort = (sort: CustomReportSort): void => {
    dispatch({ type: 'ADD_SORT', sort })
  }
  const handleRemoveSort = (id: string): void => {
    dispatch({ type: 'REMOVE_SORT', id })
  }
  const handleSetSortDirection = (id: string, direction: CustomReportSortDirection): void => {
    dispatch({ type: 'SET_SORT_DIRECTION', id, direction })
  }
  const handleMoveSort = (id: string, direction: 'up' | 'down'): void => {
    dispatch({ type: 'MOVE_SORT', id, direction })
  }
  const handleSetChartType = (chartType: CustomReportVisualization['type']): void => {
    dispatch({ type: 'SET_CHART_TYPE', chartType })
  }
  const handleUpdateVisualization = (patch: Partial<CustomReportVisualization>): void => {
    dispatch({ type: 'UPDATE_VISUALIZATION', patch })
  }

  // ─── Permission gate (Contract D.31) ─────────────────────────────────
  if (!canReadReport || !hasAnySourceRead) {
    return (
      <PermissionLimitedState
        title="Reports access limited"
        message="Custom reports require REPORT:READ plus read access to at least one data source (Contacts, Deals, Tasks or Activities)."
        requiredPermission="reports:read"
      />
    )
  }

  // Edit-mode loading / error states.
  if (reportId) {
    if (editQuery.isLoading) {
      return (
        <div className="mx-auto w-full max-w-[1440px]">
          <LoadingSkeleton />
        </div>
      )
    }
    if (editQuery.isError) {
      return (
        <div className="mx-auto w-full max-w-[1440px]">
          <ErrorState
            title="Could not load report"
            message={(editQuery.error as Error).message || 'Something went wrong'}
            onRetry={() => editQuery.refetch()}
          />
        </div>
      )
    }
  }

  const sourceGate = draft.source ? canReadSource(draft.source) : true

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
            Custom report builder
          </h1>
          <p className="mt-1.5 max-w-[64ch] text-[13.5px] text-[#77777f]">
            Pick a data source, choose dimensions and metrics, then a visualization. The preview
            updates automatically as you build. Drag fields — or use the Add / Remove / Move
            buttons, which always work.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'RESET' })
              setSeeded(false)
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Reset
          </button>
          {showSaveButton ? (
            <button
              type="button"
              disabled={!canSave || !sourceGate}
              onClick={() => setSaveOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[9px] bg-[#1b1b1f] px-4 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              Save report
            </button>
          ) : null}
        </div>
      </div>

      {/* Mobile section tabs (Contract D.32) */}
      <div className="mt-4 flex gap-1.5 lg:hidden">
        {(
          [
            ['source', '1 · Data Source'],
            ['fields', '2 · Fields'],
            ['viz', '3 · Visualization'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={mobileSection === key}
            onClick={() => setMobileSection(key)}
            className={`h-9 flex-1 rounded-[9px] border text-[12.5px] font-medium transition-colors ${
              mobileSection === key
                ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                : 'border-[#e6e6eb] bg-white text-[#4b4b55]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <div className={mobileSection === 'source' ? 'block' : 'hidden lg:block'}>
            <CustomReportDataSourcePanel
              draft={draft}
              catalog={catalogQuery.data ?? null}
              catalogLoading={catalogQuery.isLoading}
              catalogError={catalogQuery.isError ? (catalogQuery.error as Error).message : null}
              canReadSource={canReadSource}
              onSourceChange={handleSourceChange}
              onAddFilter={(filter: CustomReportFilter) => dispatch({ type: 'ADD_FILTER', filter })}
              onUpdateFilter={(id, patch) => dispatch({ type: 'UPDATE_FILTER', id, patch })}
              onRemoveFilter={(id) => dispatch({ type: 'REMOVE_FILTER', id })}
            />
          </div>
          <div className={mobileSection === 'fields' ? 'block' : 'hidden lg:block'}>
            <CustomReportFieldsPanel
              draft={draft}
              catalog={catalogQuery.data ?? null}
              catalogLoading={catalogQuery.isLoading}
              catalogError={catalogQuery.isError ? (catalogQuery.error as Error).message : null}
              onAddDimension={handleAddDimension}
              onAddMetric={handleAddMetric}
              onAddCountMetric={handleAddCountMetric}
              onRemoveItem={handleRemoveItem}
              onMoveItem={handleMoveItem}
              onSetAggregation={handleSetAggregation}
              onSetGranularity={handleSetGranularity}
              onAddCalculatedField={handleAddCalculatedField}
              onRemoveCalculatedField={handleRemoveCalculatedField}
              onReorderItems={handleReorderItems}
              onAddSort={handleAddSort}
              onRemoveSort={handleRemoveSort}
              onSetSortDirection={handleSetSortDirection}
              onMoveSort={handleMoveSort}
            />
          </div>
          <div className={mobileSection === 'viz' ? 'block' : 'hidden lg:block'}>
            <CustomReportVisualizationPanel
              draft={draft}
              catalog={catalogQuery.data ?? null}
              onSetChartType={handleSetChartType}
              onUpdateVisualization={handleUpdateVisualization}
            />
          </div>
        </div>

        <div className="min-w-0 lg:sticky lg:top-[76px]">
          <CustomReportPreview
            draft={draft}
            catalog={catalogQuery.data}
            validation={validation}
            result={previewQuery.data ?? null}
            isLoading={previewQuery.isLoading && !previewQuery.data}
            isRefreshing={previewQuery.isFetching && !!previewQuery.data}
            isError={previewQuery.isError && !previewQuery.data}
            errorMessage={previewQuery.isError ? (previewQuery.error as Error).message : null}
            onRetry={() => previewQuery.refetch()}
          />
          {/* Announced preview result changes (Contract D.32) */}
          <span role="status" className="sr-only">
            {previewQuery.data ? `Preview updated with ${previewQuery.data.totalRows} rows` : ''}
          </span>
        </div>
      </div>

      <SaveCustomReportDialog
        open={saveOpen}
        isEditing={!!reportId}
        isSubmitting={saveMutation.isPending}
        onOpenChange={setSaveOpen}
        onSubmit={(values) => {
          if (!config) return
          saveMutation.mutate({
            reportId: reportId ?? undefined,
            name: values.name,
            config,
            isPublic: values.isPublic,
          })
        }}
      />
    </div>
  )
}
