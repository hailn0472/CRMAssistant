'use client'

/**
 * Story 6.3 — Data Source section of the custom report builder (AC 5, D.24).
 *
 * Four entity choices (Contacts/Deals/Tasks/Activities), source-specific
 * filter rows driven by the server-owned field catalogue, an active-filter
 * summary that stays visible so users cannot misread the preview scope, and
 * the source-change confirmation flow (Contract D.25): changing source after
 * selections exist requires confirmation; cancel preserves the draft.
 */
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import { CUSTOM_REPORT_SOURCE_READ_GATE } from '@/services/custom-report.service'
import type {
  CustomReportCatalog,
  CustomReportDataSource,
  CustomReportDraft,
  CustomReportField,
  CustomReportFilter,
  CustomReportFilterOperator,
} from '@/lib/custom-report-builder'
import {
  CUSTOM_REPORT_DATA_SOURCES,
  MAX_FILTERS,
  SOURCE_LABELS,
  createDraftId,
} from '@/lib/custom-report-builder'

const SOURCE_ICONS: Record<CustomReportDataSource, string> = {
  CONTACTS: '👥',
  DEALS: '💼',
  TASKS: '✅',
  ACTIVITIES: '📅',
}

const OPERATOR_LABELS: Record<CustomReportFilterOperator, string> = {
  EQ: 'is',
  NOT_EQ: 'is not',
  CONTAINS: 'contains',
  IN: 'in',
  GT: '>',
  GTE: '≥',
  LT: '<',
  LTE: '≤',
  BETWEEN: 'between',
  ON: 'on',
  BEFORE: 'before',
  AFTER: 'after',
  HAS_ANY: 'has any',
  HAS_ALL: 'has all',
}

type CustomReportDataSourcePanelProps = {
  draft: CustomReportDraft
  catalog: CustomReportCatalog | null
  catalogLoading: boolean
  catalogError: string | null
  canReadSource: (source: CustomReportDataSource) => boolean
  onSourceChange: (source: CustomReportDataSource) => void
  onAddFilter: (filter: CustomReportFilter) => void
  onUpdateFilter: (id: string, patch: Partial<CustomReportFilter>) => void
  onRemoveFilter: (id: string) => void
}

function filterableFields(catalog: CustomReportCatalog | null): CustomReportField[] {
  return (catalog?.fields ?? []).filter((f) => f.roles.includes('FILTER'))
}

function emptyFilter(field: CustomReportField): CustomReportFilter {
  const operator = field.filterOperators[0] ?? 'EQ'
  return {
    id: createDraftId('filter'),
    fieldId: field.key,
    operator,
    stringValue: null,
    numberValue: null,
    booleanValue: null,
    dateValue: null,
    stringValues: null,
    numberValues: null,
    dateValues: null,
  }
}

function isNumericOperator(operator: CustomReportFilterOperator): boolean {
  return ['GT', 'GTE', 'LT', 'LTE'].includes(operator)
}

function filterValueSummary(filter: CustomReportFilter): string {
  const values = [
    filter.stringValue,
    filter.numberValue !== null ? String(filter.numberValue) : null,
    filter.booleanValue !== null ? String(filter.booleanValue) : null,
    filter.dateValue,
    filter.stringValues?.join(', '),
    filter.numberValues?.join(', '),
    filter.dateValues?.join(', '),
  ].filter((v): v is string => v !== null && v !== undefined && v !== '')
  return values.length > 0 ? values.join(', ') : '…'
}

export function CustomReportDataSourcePanel({
  draft,
  catalog,
  catalogLoading,
  catalogError,
  canReadSource,
  onSourceChange,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
}: CustomReportDataSourcePanelProps): React.JSX.Element {
  const [pendingSource, setPendingSource] = useState<CustomReportDataSource | null>(null)
  const hasSelections =
    draft.filters.length > 0 ||
    draft.dimensions.length > 0 ||
    draft.metrics.length > 0 ||
    draft.calculatedFields.length > 0 ||
    draft.sort.length > 0

  const fields = filterableFields(catalog)
  const fieldByKey = new Map(catalog?.fields.map((f) => [f.key, f]) ?? [])

  function handleSourceClick(source: CustomReportDataSource): void {
    if (source === draft.source) return
    if (hasSelections) {
      setPendingSource(source)
      return
    }
    onSourceChange(source)
  }

  function confirmSourceChange(): void {
    if (!pendingSource) return
    onSourceChange(pendingSource)
    setPendingSource(null)
  }

  function renderFilterValue(
    filter: CustomReportFilter,
    field: CustomReportField | undefined,
  ): React.JSX.Element {
    const operator = filter.operator
    const isMulti = ['IN', 'HAS_ANY', 'HAS_ALL'].includes(operator)
    const isBetween = operator === 'BETWEEN'
    const isNumeric = isNumericOperator(operator) || (isBetween && field?.isNumeric)
    const isDate = (isBetween && field?.isDate) || ['ON', 'BEFORE', 'AFTER'].includes(operator)

    if (isBetween && field) {
      return (
        <div className="flex items-center gap-1.5">
          <input
            type={field.isDate ? 'date' : 'number'}
            aria-label="Minimum"
            value={filter.numberValues?.[0] ?? filter.dateValues?.[0] ?? ''}
            onChange={(e) => {
              const value = e.target.value
              onUpdateFilter(filter.id, {
                numberValues: field.isDate ? null : [Number(value)],
                dateValues: field.isDate ? [value] : null,
              })
            }}
            className="h-9 w-full rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
          />
          <span aria-hidden="true" className="text-[12px] text-[#8c8c96]">
            and
          </span>
          <input
            type={field.isDate ? 'date' : 'number'}
            aria-label="Maximum"
            value={filter.numberValues?.[1] ?? filter.dateValues?.[1] ?? ''}
            onChange={(e) => {
              const value = e.target.value
              onUpdateFilter(filter.id, {
                numberValues: field.isDate ? null : [filter.numberValues?.[0] ?? 0, Number(value)],
                dateValues: field.isDate ? [filter.dateValues?.[0] ?? '', value] : null,
              })
            }}
            className="h-9 w-full rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
          />
        </div>
      )
    }

    if (field?.valueType === 'BOOLEAN' && operator === 'EQ') {
      return (
        <select
          aria-label="Value"
          value={filter.booleanValue === null ? '' : String(filter.booleanValue)}
          onChange={(e) => onUpdateFilter(filter.id, { booleanValue: e.target.value === 'true' })}
          className="h-9 w-full cursor-pointer rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
        >
          <option value="">Select…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )
    }

    if (isMulti) {
      return (
        <input
          type="text"
          aria-label="Values (comma separated)"
          value={filter.stringValues?.join(', ') ?? filter.numberValues?.join(', ') ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            const parts = raw
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
            onUpdateFilter(filter.id, {
              stringValues: field?.isNumeric ? null : parts,
              numberValues: field?.isNumeric ? parts.map(Number) : null,
            })
          }}
          placeholder="Comma separated values"
          className="h-9 w-full rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
        />
      )
    }

    if (isNumeric) {
      return (
        <input
          type="number"
          aria-label="Value"
          value={filter.numberValue === null ? '' : String(filter.numberValue)}
          onChange={(e) =>
            onUpdateFilter(filter.id, {
              numberValue: e.target.value === '' ? null : Number(e.target.value),
            })
          }
          className="h-9 w-full rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
        />
      )
    }

    if (isDate) {
      return (
        <input
          type="date"
          aria-label="Value"
          value={filter.dateValue ?? ''}
          onChange={(e) => onUpdateFilter(filter.id, { dateValue: e.target.value || null })}
          className="h-9 w-full rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
        />
      )
    }

    return (
      <input
        type="text"
        aria-label="Value"
        value={filter.stringValue ?? ''}
        onChange={(e) => onUpdateFilter(filter.id, { stringValue: e.target.value || null })}
        className="h-9 w-full rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
      />
    )
  }

  return (
    <section
      aria-label="Data source"
      className="rounded-[14px] border border-[#ececf0] bg-white p-[18px]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-[#1b1b1f] text-[12px] font-bold text-white">
          1
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Data Source</h2>
          <p className="mt-0.5 text-[12.5px] text-[#77777f]">
            Choose one entity and apply source-specific filters.
          </p>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2.5">
        {CUSTOM_REPORT_DATA_SOURCES.map((source) => {
          const selected = source === draft.source
          const readable = canReadSource(source)
          return (
            <button
              key={source}
              type="button"
              aria-pressed={selected}
              disabled={!readable}
              onClick={() => handleSourceClick(source)}
              className={`flex min-h-[52px] items-center gap-2.5 rounded-[10px] border px-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f] disabled:cursor-not-allowed disabled:opacity-45 ${
                selected
                  ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                  : 'border-[#e6e6eb] bg-[#fafafb] hover:border-[#1b1b1f]'
              }`}
            >
              <span aria-hidden="true" className="text-[18px]">
                {SOURCE_ICONS[source]}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{SOURCE_LABELS[source]}</span>
                <span
                  className={`block text-[11px] ${selected ? 'text-white/60' : 'text-[#8c8c96]'}`}
                >
                  REPORT:READ + {CUSTOM_REPORT_SOURCE_READ_GATE[source]}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Filter rows */}
      <div className="mt-3 flex flex-col gap-2">
        {catalogLoading ? (
          <p className="text-[12.5px] text-[#8c8c96]">Loading fields…</p>
        ) : catalogError ? (
          <p role="alert" className="text-[12.5px] text-[#dc2626]">
            {catalogError}
          </p>
        ) : (
          draft.filters.map((filter) => {
            const field = fieldByKey.get(filter.fieldId)
            return (
              <div key={filter.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-[#8c8c96]">Field</span>
                  <select
                    aria-label="Filter field"
                    value={filter.fieldId}
                    onChange={(e) => {
                      const next = fieldByKey.get(e.target.value)
                      const operator = next?.filterOperators[0] ?? 'EQ'
                      onUpdateFilter(filter.id, {
                        fieldId: e.target.value,
                        operator,
                        stringValue: null,
                        numberValue: null,
                        booleanValue: null,
                        dateValue: null,
                        stringValues: null,
                        numberValues: null,
                        dateValues: null,
                      })
                    }}
                    className="h-9 cursor-pointer rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
                  >
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-[#8c8c96]">Operator</span>
                  <select
                    aria-label="Operator"
                    value={filter.operator}
                    onChange={(e) =>
                      onUpdateFilter(filter.id, {
                        operator: e.target.value as CustomReportFilterOperator,
                      })
                    }
                    className="h-9 cursor-pointer rounded-[9px] border border-[#e6e6eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#1b1b1f]"
                  >
                    {(field?.filterOperators ?? []).map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="min-w-[120px]">{renderFilterValue(filter, field)}</div>
                <button
                  type="button"
                  aria-label={`Remove filter ${field?.label ?? filter.fieldId}`}
                  onClick={() => onRemoveFilter(filter.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-[#e6e6eb] bg-white text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            )
          })
        )}
      </div>

      {catalog && !catalogError && !catalogLoading ? (
        <button
          type="button"
          onClick={() => {
            const first = filterableFields(catalog)[0]
            if (first) onAddFilter(emptyFilter(first))
          }}
          disabled={draft.filters.length >= MAX_FILTERS}
          className="mt-2.5 inline-flex min-h-[28px] items-center gap-1.5 rounded-[7px] border border-dashed border-[#e6e6eb] px-2.5 text-[12px] font-medium text-[#4b4b55] transition-colors hover:border-[#1b1b1f] hover:text-[#1b1b1f] disabled:opacity-45"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add filter
        </button>
      ) : null}

      {/* Active-filter summary — always visible (Contract D.25) */}
      <div aria-label="Active filters" className="mt-3 flex min-h-6 flex-wrap gap-1.5">
        {draft.filters.length === 0 ? (
          <span className="text-[12px] text-[#8c8c96]">
            No filters — all visible{' '}
            {draft.source ? SOURCE_LABELS[draft.source].toLowerCase() : 'records'} are included.
          </span>
        ) : (
          draft.filters.map((filter) => {
            const field = fieldByKey.get(filter.fieldId)
            return (
              <span
                key={filter.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#e6e6eb] bg-[#fafafb] px-2.5 text-[12px] font-medium text-[#4b4b55]"
              >
                <b className="font-semibold text-[#1b1b1f]">{field?.label ?? filter.fieldId}</b>
                {OPERATOR_LABELS[filter.operator]}
                <span>{filterValueSummary(filter)}</span>
                <button
                  type="button"
                  aria-label={`Remove filter ${field?.label ?? filter.fieldId}`}
                  onClick={() => onRemoveFilter(filter.id)}
                  className="flex h-4 w-4 items-center justify-center text-[#8c8c96] hover:text-[#1b1b1f]"
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </span>
            )
          })
        )}
      </div>

      {/* Source-change confirmation (Contract D.25) */}
      {pendingSource ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-change-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
        >
          <div className="w-full max-w-[420px] rounded-[14px] bg-white p-5 shadow-lg">
            <h3 id="source-change-title" className="text-[16px] font-semibold text-[#1b1b1f]">
              Change data source?
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[#4b4b55]">
              Switching to {SOURCE_LABELS[pendingSource]} clears the current filters, dimensions,
              metrics, calculated fields and sorting. Your current source{' '}
              <b>{draft.source ? SOURCE_LABELS[draft.source] : ''}</b> stays selected if you cancel.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSource(null)}
                className="inline-flex min-h-[44px] items-center rounded-[9px] border border-[#e6e6eb] bg-white px-4 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSourceChange}
                className="inline-flex min-h-[44px] items-center rounded-[9px] bg-[#1b1b1f] px-4 text-[13px] font-medium text-white transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
              >
                Change source
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
