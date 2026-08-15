'use client'

/**
 * Story 6.3 — Fields section of the custom report builder (AC 6-8, 13-14).
 *
 * Searchable available-field palette, Dimensions and Metrics drop zones,
 * aggregation/granularity controls and the calculated-field editor. Uses
 * @dnd-kit PointerSensor (8px activation), TouchSensor and KeyboardSensor
 * with DragOverlay, stable IDs and screen-reader announcements that name
 * fields and destination lists (Contract D.26). Every drag action has
 * equivalent Add as dimension / Add as metric, Remove, Move up and Move down
 * buttons — no workflow is drag-only.
 */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronUp, GripVertical, Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import type {
  CustomReportAggregation,
  CustomReportCalculatedField,
  CustomReportCatalog,
  CustomReportDimension,
  CustomReportDraft,
  CustomReportGranularity,
  CustomReportMetric,
  CustomReportSort,
  CustomReportSortDirection,
} from '@/lib/custom-report-builder'
import {
  AGGREGATION_LABELS,
  CUSTOM_REPORT_GRANULARITIES,
  CUSTOM_REPORT_SORT_DIRECTIONS,
  MAX_SORTS,
  MAX_TOTAL_METRICS,
  SOURCE_LABELS,
  createDraftId,
  defaultAggregationFor,
  expressionDiagnostics,
} from '@/lib/custom-report-builder'

type CustomReportFieldsPanelProps = {
  draft: CustomReportDraft
  catalog: CustomReportCatalog | null
  catalogLoading: boolean
  catalogError: string | null
  onAddDimension: (fieldId: string) => void
  onAddMetric: (fieldId: string, aggregation?: CustomReportAggregation) => void
  onAddCountMetric: () => void
  onRemoveItem: (role: 'dimension' | 'metric', id: string) => void
  onMoveItem: (role: 'dimension' | 'metric', id: string, direction: 'up' | 'down') => void
  onSetAggregation: (metricId: string, aggregation: CustomReportAggregation) => void
  onSetGranularity: (dimensionId: string, granularity: CustomReportGranularity | null) => void
  onAddCalculatedField: (field: CustomReportCalculatedField) => void
  onRemoveCalculatedField: (id: string) => void
  onReorderItems: (role: 'dimension' | 'metric', orderedIds: string[]) => void
  onAddSort: (sort: CustomReportSort) => void
  onRemoveSort: (id: string) => void
  onSetSortDirection: (id: string, direction: CustomReportSortDirection) => void
  onMoveSort: (id: string, direction: 'up' | 'down') => void
}

const VALUE_TYPE_TAG: Record<string, string> = {
  DATE: 'date',
  DATETIME: 'date',
  NUMBER: 'num',
  CURRENCY: 'num',
  ENUM: 'enum',
  RELATION: 'enum',
  TAGS: 'tags',
  BOOLEAN: 'bool',
  STRING: 'str',
}

function valueTagClass(valueType: string): string {
  const tag = VALUE_TYPE_TAG[valueType] ?? 'str'
  if (tag === 'date') return 'bg-[#eef2ff] text-[#4338ca]'
  if (tag === 'num') return 'bg-[#ecfdf5] text-[#047857]'
  if (tag === 'tags') return 'bg-[#f5f3ff] text-[#6d28d9]'
  return 'bg-[#f1f5f9] text-[#475569]'
}

function SortableSelectedItem({
  id,
  role,
  label,
  meta,
  dragDisabled,
  onRemove,
  onMoveUp,
  onMoveDown,
  children,
}: {
  id: string
  role: 'dimension' | 'metric'
  label: string
  meta?: string
  dragDisabled: boolean
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${role}:${id}`,
    disabled: dragDisabled,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`mb-1.5 flex items-center gap-2 rounded-lg border border-[#e6e6eb] bg-white px-2.5 py-2 last:mb-0 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <button
        type="button"
        aria-label={`Drag ${role} ${label}`}
        {...attributes}
        {...listeners}
        disabled={dragDisabled}
        className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-[#cbd5e1] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripVertical aria-hidden="true" className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[#1b1b1f]">{label}</span>
        {meta ? <span className="block text-[10.5px] text-[#8c8c96]">{meta}</span> : null}
      </div>
      {children}
      <div className="flex flex-none gap-0.5">
        <button
          type="button"
          aria-label={`Move up ${role} ${label}`}
          onClick={onMoveUp}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8c8c96] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f]"
        >
          <ChevronUp aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={`Move down ${role} ${label}`}
          onClick={onMoveDown}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8c8c96] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f]"
        >
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={`Remove ${role} ${label}`}
          onClick={onRemove}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8c8c96] transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function DropZone({
  zoneId,
  ariaLabel,
  title,
  count,
  hint,
  children,
}: {
  zoneId: string
  ariaLabel: string
  title: string
  count: number
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: zoneId })
  return (
    <div
      ref={setNodeRef}
      aria-label={ariaLabel}
      className={`rounded-[10px] border-1.5 border-dashed p-2.5 transition-colors ${
        isOver ? 'border-[#2563eb] bg-[#eff6ff]' : 'border-[#e6e6eb] bg-[#fafafb]'
      }`}
    >
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1b1b1f]">
        {title}
        <span className="rounded-full bg-[#f1f5f9] px-1.5 text-[11px] font-semibold text-[#64748b]">
          {count}
        </span>
      </h3>
      {count === 0 ? (
        <p className="px-2 py-3.5 text-center text-[12px] text-[#8c8c96]">{hint}</p>
      ) : null}
      {children}
    </div>
  )
}

export function CustomReportFieldsPanel({
  draft,
  catalog,
  catalogLoading,
  catalogError,
  onAddDimension,
  onAddMetric,
  onAddCountMetric,
  onRemoveItem,
  onMoveItem,
  onSetAggregation,
  onSetGranularity,
  onAddCalculatedField,
  onRemoveCalculatedField,
  onReorderItems,
  onAddSort,
  onRemoveSort,
  onSetSortDirection,
  onMoveSort,
}: CustomReportFieldsPanelProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [calcEditorOpen, setCalcEditorOpen] = useState(false)
  const [calcAlias, setCalcAlias] = useState('')
  const [calcLabel, setCalcLabel] = useState('')
  const [calcExpression, setCalcExpression] = useState('')
  const [calcError, setCalcError] = useState<string | null>(null)
  const [sortEditorOpen, setSortEditorOpen] = useState(false)
  const [sortTargetId, setSortTargetId] = useState('')
  const [sortDirection, setSortDirection] = useState<CustomReportSortDirection>('ASC')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  )

  const fieldByKey = useMemo(
    () => new Map((catalog?.fields ?? []).map((f) => [f.key, f])),
    [catalog],
  )
  const metricFields = useMemo(
    () => (catalog?.fields ?? []).filter((f) => f.roles.includes('METRIC')),
    [catalog],
  )
  // The palette lists every field usable in the builder (dimension and/or
  // metric role) so metric-only fields stay discoverable (AC 7/8).
  const paletteFields = useMemo(
    () =>
      (catalog?.fields ?? []).filter(
        (f) => f.roles.includes('DIMENSION') || f.roles.includes('METRIC'),
      ),
    [catalog],
  )

  const visibleFields = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return paletteFields
    return paletteFields.filter(
      (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q),
    )
  }, [paletteFields, searchQuery])

  const selectedDimensionKeys = useMemo(
    () => new Set(draft.dimensions.map((d) => d.fieldId).filter((k): k is string => !!k)),
    [draft.dimensions],
  )
  const selectedMetricKeys = useMemo(
    () => new Set(draft.metrics.map((m) => m.fieldId)),
    [draft.metrics],
  )

  const countField = useMemo(() => {
    if (!catalog || !draft.source) return null
    const expected = `${draft.source.toLowerCase()}.id`
    return (
      catalog.fields.find((f) => f.key === expected && f.roles.includes('METRIC')) ??
      metricFields[0] ??
      null
    )
  }, [catalog, draft.source, metricFields])

  function resolveDragLabel(id: string): string {
    if (id.startsWith('palette:')) {
      return fieldByKey.get(id.slice('palette:'.length))?.label ?? 'field'
    }
    if (id.startsWith('dim:')) {
      const dim = draft.dimensions.find((d) => d.id === id.slice(4))
      return dim?.fieldId ? fieldByKey.get(dim.fieldId)?.label ?? dim.fieldId : 'dimension'
    }
    if (id.startsWith('metric:')) {
      const metric = draft.metrics.find((m) => m.id === id.slice(7))
      return metric?.fieldId ? fieldByKey.get(metric.fieldId)?.label ?? metric.fieldId : 'metric'
    }
    return id
  }

  function resolveDropLabel(id: string): string {
    if (id === 'zone:dimension') return 'the Dimensions list'
    if (id === 'zone:metric') return 'the Metrics list'
    return resolveDragLabel(id)
  }

  function handleDragStart(event: DragStartEvent): void {
    setActiveDragId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveDragId(null)
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    if (activeId.startsWith('palette:')) {
      const fieldKey = activeId.slice('palette:'.length)
      const field = fieldByKey.get(fieldKey)
      if (!field) return
      if (overId === 'zone:dimension' || overId.startsWith('dim:')) {
        if (field.roles.includes('DIMENSION')) onAddDimension(fieldKey)
      } else if (overId === 'zone:metric' || overId.startsWith('metric:')) {
        if (field.roles.includes('METRIC')) onAddMetric(fieldKey, defaultAggregationFor(field))
      }
      return
    }

    if (activeId.startsWith('dim:') && (overId.startsWith('dim:') || overId === 'zone:dimension')) {
      if (overId === 'zone:dimension' || activeId === overId) return
      reorderList('dimension', draft.dimensions, activeId.slice(4), overId.slice(4))
    } else if (
      activeId.startsWith('metric:') &&
      (overId.startsWith('metric:') || overId === 'zone:metric')
    ) {
      if (overId === 'zone:metric' || activeId === overId) return
      reorderList('metric', draft.metrics, activeId.slice(7), overId.slice(7))
    }
  }

  function reorderList(
    role: 'dimension' | 'metric',
    list: Array<CustomReportDimension | CustomReportMetric>,
    activeItemId: string,
    overItemId: string,
  ): void {
    const from = list.findIndex((item) => item.id === activeItemId)
    const to = list.findIndex((item) => item.id === overItemId)
    if (from === -1 || to === -1 || from === to) return
    const reordered = [...list]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    onReorderItems(
      role,
      reordered.map((item) => item.id),
    )
  }

  function handleAddCalculatedField(): void {
    const aliases = draft.metrics.map((m) => m.alias)
    if (!calcAlias.trim()) {
      setCalcError('Calculated field needs an alias.')
      return
    }
    if (aliases.includes(calcAlias.trim())) {
      setCalcError(`Duplicate calculated alias: ${calcAlias.trim()}`)
      return
    }
    const diag = expressionDiagnostics(calcExpression, aliases)
    if (diag.error) {
      setCalcError(diag.error)
      return
    }
    onAddCalculatedField({
      id: createDraftId('calc'),
      alias: calcAlias.trim(),
      label: calcLabel.trim() || null,
      expression: calcExpression.trim(),
    })
    setCalcAlias('')
    setCalcLabel('')
    setCalcExpression('')
    setCalcError(null)
    setCalcEditorOpen(false)
  }

  function handleAddSortRule(): void {
    const targetId = sortTargetId || sortTargets[0]?.id
    if (!targetId) return
    onAddSort({ id: createDraftId('sort'), targetId, direction: sortDirection })
    setSortEditorOpen(false)
    setSortTargetId('')
    setSortDirection('ASC')
  }

  // Sort targets are exactly the selected dimension/metric/calculated ids
  // (Contract A.9 — the server rejects anything else).
  const sortTargets = useMemo(
    () => [
      ...draft.dimensions.map((dim) => {
        const field = dim.fieldId ? fieldByKey.get(dim.fieldId) : undefined
        return {
          id: dim.id,
          role: 'dimension' as const,
          label: field?.label ?? dim.fieldId ?? 'Calculated',
        }
      }),
      ...draft.metrics.map((metric) => {
        const field = fieldByKey.get(metric.fieldId)
        return {
          id: metric.id,
          role: 'metric' as const,
          label: `${field?.label ?? metric.fieldId} (${metric.alias})`,
        }
      }),
      ...draft.calculatedFields.map((calc) => ({
        id: calc.id,
        role: 'calculated' as const,
        label: calc.alias,
      })),
    ],
    [draft.dimensions, draft.metrics, draft.calculatedFields, fieldByKey],
  )

  const sortRoleLabel: Record<(typeof sortTargets)[number]['role'], string> = {
    dimension: 'Dimension',
    metric: 'Metric',
    calculated: 'Calculated',
  }

  const dimensionIds = draft.dimensions.map((d) => `dim:${d.id}`)
  const metricIds = draft.metrics.map((m) => `metric:${m.id}`)

  return (
    <section
      aria-label="Fields"
      className="rounded-[14px] border border-[#ececf0] bg-white p-[18px]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-[#1b1b1f] text-[12px] font-bold text-white">
          2
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Fields</h2>
          <p className="mt-0.5 text-[12.5px] text-[#77777f]">
            Drag fields into Dimensions and Metrics (or use the Add / Move buttons — they always
            work).
          </p>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${resolveDragLabel(String(active.id))}`,
            onDragOver: ({ active, over }) =>
              over
                ? `${resolveDragLabel(String(active.id))} is over ${resolveDropLabel(String(over.id))}`
                : `${resolveDragLabel(String(active.id))} is not over a target`,
            onDragEnd: ({ active, over }) =>
              over
                ? `Dropped ${resolveDragLabel(String(active.id))} on ${resolveDropLabel(String(over.id))}`
                : `${resolveDragLabel(String(active.id))} was dropped`,
            onDragCancel: ({ active }) =>
              `Dragging cancelled. ${resolveDragLabel(String(active.id))} was returned.`,
          },
        }}
      >
        <div className="mt-3.5 flex flex-col gap-3.5">
          {catalogLoading ? (
            <p className="text-[12.5px] text-[#8c8c96]">Loading fields…</p>
          ) : catalogError ? (
            <p role="alert" className="text-[12.5px] text-[#dc2626]">
              {catalogError}
            </p>
          ) : (
            <>
              {/* Palette */}
              <div>
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#8c8c96]"
                  />
                  <input
                    type="text"
                    aria-label="Search available fields"
                    placeholder="Search available fields…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-full rounded-[9px] border border-[#e6e6eb] bg-white pl-8 pr-3 text-[13px] outline-none focus:border-[#1b1b1f]"
                  />
                </div>
                <div
                  aria-label="Available fields"
                  className="mt-2 max-h-[220px] overflow-y-auto rounded-[10px] border border-[#e6e6eb] p-1.5"
                >
                  {visibleFields.length === 0 ? (
                    <p className="px-2 py-3 text-[12px] text-[#8c8c96]">No fields match.</p>
                  ) : (
                    visibleFields.map((field) => {
                      const inDimensions = selectedDimensionKeys.has(field.key)
                      const inMetrics = selectedMetricKeys.has(field.key)
                      return (
                        <div
                          key={field.key}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[#fafafb] ${
                            (inDimensions && inMetrics) ||
                            (inDimensions && !field.roles.includes('METRIC'))
                              ? 'opacity-60'
                              : ''
                          }`}
                        >
                          <span className="flex-none text-[#cbd5e1]">
                            <GripVertical aria-hidden="true" className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-[#1b1b1f]">
                              {field.label}
                            </span>
                            <span className="block truncate text-[11px] text-[#8c8c96]">
                              {field.key}
                            </span>
                          </span>
                          <span
                            className={`flex-none rounded px-1.5 py-0.5 text-[10px] font-semibold ${valueTagClass(field.valueType)}`}
                          >
                            {field.valueType.toLowerCase()}
                          </span>
                          <span className="flex flex-none gap-1">
                            {field.roles.includes('DIMENSION') ? (
                              <button
                                type="button"
                                aria-label={`Add ${field.label} as dimension`}
                                onClick={() => onAddDimension(field.key)}
                                className="h-6 rounded-md border border-[#e6e6eb] bg-white px-1.5 text-[11px] font-semibold text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
                              >
                                + dim
                              </button>
                            ) : null}
                            {field.roles.includes('METRIC') ? (
                              <button
                                type="button"
                                aria-label={`Add ${field.label} as metric`}
                                onClick={() => onAddMetric(field.key, defaultAggregationFor(field))}
                                className="h-6 rounded-md border border-[#e6e6eb] bg-white px-1.5 text-[11px] font-semibold text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
                              >
                                + met
                              </button>
                            ) : null}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Dimensions */}
              <DropZone
                zoneId="zone:dimension"
                ariaLabel="Dimensions drop zone"
                title="Dimensions"
                count={draft.dimensions.length}
                hint="Drag a field here to group by it"
              >
                <SortableContext items={dimensionIds} strategy={verticalListSortingStrategy}>
                  {draft.dimensions.map((dim) => {
                    const field = dim.fieldId ? fieldByKey.get(dim.fieldId) : undefined
                    const label = field?.label ?? dim.fieldId ?? 'Calculated'
                    const isDate = field?.isDate ?? false
                    return (
                      <SortableSelectedItem
                        key={dim.id}
                        id={dim.id}
                        role="dimension"
                        label={label}
                        dragDisabled={draft.dimensions.length < 2}
                        onRemove={() => onRemoveItem('dimension', dim.id)}
                        onMoveUp={() => onMoveItem('dimension', dim.id, 'up')}
                        onMoveDown={() => onMoveItem('dimension', dim.id, 'down')}
                      >
                        {isDate ? (
                          <select
                            aria-label={`Granularity for ${label}`}
                            value={dim.granularity ?? ''}
                            onChange={(e) =>
                              onSetGranularity(
                                dim.id,
                                (e.target.value || null) as CustomReportGranularity | null,
                              )
                            }
                            className="h-7 cursor-pointer rounded-[7px] border border-[#e6e6eb] bg-white px-1.5 text-[11.5px] text-[#4b4b55] outline-none focus:border-[#1b1b1f]"
                          >
                            <option value="">—</option>
                            {CUSTOM_REPORT_GRANULARITIES.map((g) => (
                              <option key={g} value={g}>
                                {g.toLowerCase()}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </SortableSelectedItem>
                    )
                  })}
                </SortableContext>
              </DropZone>

              {/* Metrics */}
              <DropZone
                zoneId="zone:metric"
                ariaLabel="Metrics drop zone"
                title="Metrics"
                count={draft.metrics.length}
                hint="Drag a field here to measure it"
              >
                <SortableContext items={metricIds} strategy={verticalListSortingStrategy}>
                  {draft.metrics.map((metric) => {
                    const field = fieldByKey.get(metric.fieldId)
                    const label = field?.label ?? metric.fieldId
                    return (
                      <SortableSelectedItem
                        key={metric.id}
                        id={metric.id}
                        role="metric"
                        label={label}
                        meta={metric.alias}
                        dragDisabled={draft.metrics.length < 2}
                        onRemove={() => onRemoveItem('metric', metric.id)}
                        onMoveUp={() => onMoveItem('metric', metric.id, 'up')}
                        onMoveDown={() => onMoveItem('metric', metric.id, 'down')}
                      >
                        <select
                          aria-label={`Aggregation for ${label}`}
                          value={metric.aggregation}
                          onChange={(e) =>
                            onSetAggregation(metric.id, e.target.value as CustomReportAggregation)
                          }
                          className="h-7 cursor-pointer rounded-[7px] border border-[#e6e6eb] bg-white px-1.5 text-[11.5px] text-[#4b4b55] outline-none focus:border-[#1b1b1f]"
                        >
                          {(field?.aggregations ?? []).map((agg) => (
                            <option key={agg} value={agg}>
                              {AGGREGATION_LABELS[agg]}
                            </option>
                          ))}
                        </select>
                      </SortableSelectedItem>
                    )
                  })}
                </SortableContext>
                {countField ? (
                  <button
                    type="button"
                    onClick={onAddCountMetric}
                    disabled={
                      draft.metrics.length + draft.calculatedFields.length >= MAX_TOTAL_METRICS
                    }
                    className="mt-2 inline-flex min-h-[28px] items-center gap-1.5 rounded-[7px] border border-dashed border-[#e6e6eb] px-2.5 text-[12px] font-medium text-[#4b4b55] transition-colors hover:border-[#1b1b1f] hover:text-[#1b1b1f] disabled:opacity-45"
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                    Add count of{' '}
                    {draft.source ? SOURCE_LABELS[draft.source].toLowerCase() : 'records'}
                  </button>
                ) : null}
              </DropZone>

              {/* Calculated fields */}
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1b1b1f]">
                  Calculated fields
                  <span className="rounded-full bg-[#f1f5f9] px-1.5 text-[11px] font-semibold text-[#64748b]">
                    {draft.calculatedFields.length}
                  </span>
                </h3>
                {draft.calculatedFields.map((calc) => (
                  <div
                    key={calc.id}
                    className="mb-1.5 flex items-center gap-2 rounded-lg border border-[#e6e6eb] bg-[#fafafb] px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[#1b1b1f]">
                        {calc.alias}
                      </span>
                      <code className="block truncate text-[11.5px] text-[#4b4b55]">
                        {calc.expression}
                      </code>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove calculated field ${calc.alias}`}
                      onClick={() => onRemoveCalculatedField(calc.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#8c8c96] transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {calcEditorOpen ? (
                  <div className="mt-2 rounded-[10px] border border-[#e6e6eb] bg-[#fafafb] p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-[#8c8c96]">Alias</span>
                        <input
                          type="text"
                          aria-label="Alias"
                          value={calcAlias}
                          onChange={(e) => setCalcAlias(e.target.value)}
                          placeholder="avg_deal_size"
                          className="h-9 rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 font-mono text-[12.5px] outline-none focus:border-[#1b1b1f]"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-[#8c8c96]">Label</span>
                        <input
                          type="text"
                          aria-label="Label"
                          value={calcLabel}
                          onChange={(e) => setCalcLabel(e.target.value)}
                          placeholder="Avg deal size"
                          className="h-9 rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[12.5px] outline-none focus:border-[#1b1b1f]"
                        />
                      </label>
                    </div>
                    <label className="mt-2 flex flex-col gap-1">
                      <span className="text-[11.5px] font-medium text-[#8c8c96]">Expression</span>
                      <input
                        type="text"
                        aria-label="Expression"
                        value={calcExpression}
                        onChange={(e) => setCalcExpression(e.target.value)}
                        placeholder="revenue / deals"
                        className="h-9 rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 font-mono text-[12.5px] outline-none focus:border-[#1b1b1f]"
                      />
                    </label>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[#8c8c96]">
                      Use metric aliases only:{' '}
                      {draft.metrics.map((m) => m.alias).join(', ') || 'add a metric first'}.
                      Supported: numbers, aliases, parentheses and + - * /.
                    </p>
                    {calcError ? (
                      <p role="alert" className="mt-1.5 text-[11.5px] text-[#dc2626]">
                        {calcError}
                      </p>
                    ) : null}
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddCalculatedField}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[9px] bg-[#1b1b1f] px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-black"
                      >
                        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                        Add calculated field
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCalcEditorOpen(false)
                          setCalcError(null)
                        }}
                        className="inline-flex min-h-[36px] items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCalcEditorOpen(true)}
                    disabled={
                      draft.metrics.length + draft.calculatedFields.length >= MAX_TOTAL_METRICS
                    }
                    className="mt-2 inline-flex min-h-[28px] items-center gap-1.5 rounded-[7px] border border-dashed border-[#e6e6eb] px-2.5 text-[12px] font-medium text-[#4b4b55] transition-colors hover:border-[#1b1b1f] hover:text-[#1b1b1f] disabled:opacity-45"
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                    New calculated field
                  </button>
                )}
              </div>

              {/* Sorting (AC 14) */}
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1b1b1f]">
                  Sorting
                  <span className="rounded-full bg-[#f1f5f9] px-1.5 text-[11px] font-semibold text-[#64748b]">
                    {draft.sort.length}
                  </span>
                </h3>
                <p className="mb-1.5 text-[11px] text-[#8c8c96]">
                  Sort rows by selected fields — rule order is the priority. Max {MAX_SORTS} rules.
                </p>
                {draft.sort.map((sortRule, index) => {
                  const target = sortTargets.find((t) => t.id === sortRule.targetId)
                  const label = target?.label ?? sortRule.targetId
                  const roleLabel = target ? sortRoleLabel[target.role] : 'Field'
                  return (
                    <div
                      key={sortRule.id}
                      className="mb-1.5 flex items-center gap-2 rounded-lg border border-[#e6e6eb] bg-white px-2.5 py-2 last:mb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[#1b1b1f]">
                          {label}
                        </span>
                        <span className="block text-[10.5px] text-[#8c8c96]">{roleLabel}</span>
                      </div>
                      <select
                        aria-label={`Direction for ${label}`}
                        value={sortRule.direction}
                        onChange={(e) =>
                          onSetSortDirection(
                            sortRule.id,
                            e.target.value as CustomReportSortDirection,
                          )
                        }
                        className="h-7 cursor-pointer rounded-[7px] border border-[#e6e6eb] bg-white px-1.5 text-[11.5px] text-[#4b4b55] outline-none focus:border-[#1b1b1f]"
                      >
                        {CUSTOM_REPORT_SORT_DIRECTIONS.map((d) => (
                          <option key={d} value={d}>
                            {d === 'ASC' ? 'Ascending' : 'Descending'}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-none gap-0.5">
                        <button
                          type="button"
                          aria-label={`Move up sort rule ${label}`}
                          onClick={() => onMoveSort(sortRule.id, 'up')}
                          disabled={index === 0}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8c8c96] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ChevronUp aria-hidden="true" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move down sort rule ${label}`}
                          onClick={() => onMoveSort(sortRule.id, 'down')}
                          disabled={index === draft.sort.length - 1}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8c8c96] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ChevronDown aria-hidden="true" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove sort rule ${label}`}
                          onClick={() => onRemoveSort(sortRule.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8c8c96] transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]"
                        >
                          <X aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
                {sortEditorOpen ? (
                  <div className="mt-2 rounded-[10px] border border-[#e6e6eb] bg-[#fafafb] p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-[#8c8c96]">Sort by</span>
                        <select
                          aria-label="Sort by"
                          value={sortTargetId}
                          onChange={(e) => setSortTargetId(e.target.value)}
                          className="h-9 cursor-pointer rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[12.5px] outline-none focus:border-[#1b1b1f]"
                        >
                          {sortTargets.map((t) => (
                            <option key={t.id} value={t.id}>
                              {sortRoleLabel[t.role]}: {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-[#8c8c96]">Direction</span>
                        <select
                          aria-label="Sort direction"
                          value={sortDirection}
                          onChange={(e) =>
                            setSortDirection(e.target.value as CustomReportSortDirection)
                          }
                          className="h-9 cursor-pointer rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[12.5px] outline-none focus:border-[#1b1b1f]"
                        >
                          {CUSTOM_REPORT_SORT_DIRECTIONS.map((d) => (
                            <option key={d} value={d}>
                              {d === 'ASC' ? 'Ascending' : 'Descending'}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddSortRule}
                        disabled={sortTargets.length === 0}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[9px] bg-[#1b1b1f] px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-black disabled:opacity-45"
                      >
                        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                        Add sort rule
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSortEditorOpen(false)
                          setSortTargetId('')
                          setSortDirection('ASC')
                        }}
                        className="inline-flex min-h-[36px] items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSortTargetId(sortTargets[0]?.id ?? '')
                      setSortEditorOpen(true)
                    }}
                    disabled={draft.sort.length >= MAX_SORTS || sortTargets.length === 0}
                    className="mt-2 inline-flex min-h-[28px] items-center gap-1.5 rounded-[7px] border border-dashed border-[#e6e6eb] px-2.5 text-[12px] font-medium text-[#4b4b55] transition-colors hover:border-[#1b1b1f] hover:text-[#1b1b1f] disabled:opacity-45"
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                    Add sort rule
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <div className="rounded-lg border border-[#2563eb] bg-white px-3 py-2 text-[13px] font-medium text-[#1b1b1f] shadow-md">
              {resolveDragLabel(activeDragId)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  )
}
