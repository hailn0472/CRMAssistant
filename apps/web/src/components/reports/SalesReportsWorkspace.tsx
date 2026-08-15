'use client'

/**
 * Story 6.2 — /reports/sales workspace (AC 64-80).
 *
 * Saved-report selector, six report-type templates, permission-aware filter
 * toolbar, comparison controls, summary metrics, accessible chart and
 * drill-down panel. TanStack Query keys are rooted at ['salesReports'] (AC 75);
 * filter changes only re-run the data query — saved report lists are never
 * wiped. The existing ON_DEAL_UPDATED subscription invalidates only report
 * data/drill keys (AC 76), guarded against StrictMode double-connect.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Minus,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import { usePermission } from '@/hooks/usePermission'
import { getUsers } from '@/services/user.service'
import { getTeams } from '@/services/team.service'
import { getDealStages } from '@/services/deal.service'
import { getProducts } from '@/services/product.service'
import { getReports, getReportData } from '@/services/sales-report.service'
import type {
  ReportDrillScope,
  ReportFilters,
  ReportGroupBy,
  ReportMetric,
  ReportMetricKey,
  ReportRow,
  ReportType,
} from '@/services/sales-report.service'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { ON_DEAL_UPDATED_SUBSCRIPTION } from '@/services/deal.service'
import {
  REPORT_TYPE_TEMPLATES,
  chartSeries,
  changePresentation,
  formatCount,
  formatDays,
  formatMoney,
  formatPercent,
} from '@/lib/sales-report-format'
import { MetricsCards } from '@/components/shared/MetricsCards'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { ErrorState } from '@/components/shared/ErrorState'
import { EmptyState } from '@/components/shared/EmptyState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { SalesReportChart } from './SalesReportChart'
import { SalesReportDrillDown } from './SalesReportDrillDown'
import { SavedReportDialog } from './SavedReportDialog'
import { Button } from '@/components/ui/button'

const DRILL_PAGE_SIZE = 20

const PRIMARY_DRILL_METRIC: Record<ReportType, ReportMetricKey> = {
  SALES_OVERVIEW: 'WON_DEALS',
  PIPELINE_ANALYSIS: 'OPEN_DEALS',
  WIN_LOSS: 'TOTAL_CLOSED',
  REVENUE_FORECAST: 'FORECAST_PIPELINE',
  TEAM_PERFORMANCE: 'WON_REVENUE',
  DEAL_VELOCITY: 'CLOSED_DEALS',
}

const fieldClass =
  'h-9 rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f]'

function metricDisplay(metric: ReportMetric, currency: string | null): string {
  switch (metric.unit) {
    case 'CURRENCY':
      return formatMoney(metric.value, currency)
    case 'PERCENT':
      return formatPercent(metric.value)
    case 'DAYS':
      return formatDays(metric.value)
    default:
      return formatCount(metric.value)
  }
}

function TrendBadge({ metric }: { metric: ReportMetric }): React.JSX.Element | null {
  const { label, icon } = changePresentation(metric)
  if (label === '—') return null
  const IconComponent =
    icon === 'up'
      ? ArrowUpRight
      : icon === 'down'
        ? ArrowDownRight
        : icon === 'flat'
          ? Minus
          : Sparkles
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1b1b1f]">
      <IconComponent aria-hidden="true" className="h-3.5 w-3.5" />
      <span>{label}</span>
    </span>
  )
}

export function SalesReportsWorkspace(): React.JSX.Element {
  const queryClient = useQueryClient()
  const router = useRouter()
  const clientRef = useRef<GraphqlSubscriptionClient | null>(null)
  const connectGuardRef = useRef(false)

  const canReadReport = usePermission('REPORT', 'READ')
  const canReadDeals = usePermission('DEAL', 'READ')
  const canCreateReport = usePermission('REPORT', 'CREATE')
  const canUpdateReport = usePermission('REPORT', 'UPDATE')
  const canDeleteReport = usePermission('REPORT', 'DELETE')

  // ─── Workspace state ────────────────────────────────────────────────
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [listPage, setListPage] = useState(1)
  const [filters, setFilters] = useState<ReportFilters>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingReport, setEditingReport] = useState<ReportRow | null>(null)
  const [drill, setDrill] = useState<{
    metricKey: ReportMetricKey
    bucketKey?: string
  } | null>(null)
  const [drillPage, setDrillPage] = useState(1)
  const [drillScope, setDrillScope] = useState<ReportDrillScope>('CURRENT')

  // ─── Saved report list (AC 11, 75) ──────────────────────────────────
  const reportsQuery = useQuery({
    queryKey: ['salesReports', 'list', listPage],
    queryFn: () => getReports(listPage, 20),
    enabled: canReadReport && canReadDeals,
  })

  // Catalogues for the filter toolbar (AC 68-69). Owner/team selectors are
  // hidden when their catalogue fails — the page never fails as a whole.
  const usersQuery = useQuery({
    queryKey: ['users', 1, 100],
    queryFn: () => getUsers(1, 100),
    enabled: canReadDeals,
  })
  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => getTeams(),
    enabled: canReadDeals,
  })
  const stagesQuery = useQuery({
    queryKey: ['deal-stages'],
    queryFn: () => getDealStages(),
    enabled: canReadDeals,
  })
  const productsQuery = useQuery({
    queryKey: ['products', 1, 100],
    queryFn: () => getProducts(1, 100),
    enabled: canReadDeals,
  })

  const selectedReport = useMemo<ReportRow | null>(() => {
    if (!selectedReportId) return null
    return reportsQuery.data?.items.find((r) => r.id === selectedReportId) ?? null
  }, [selectedReportId, reportsQuery.data])

  // ─── Report data (summary + drill) (AC 41, 48) ──────────────────────
  const drillInput = drill
    ? {
        metricKey: drill.metricKey,
        bucketKey: drill.bucketKey,
        page: drillPage,
        pageSize: DRILL_PAGE_SIZE,
        scope: drillScope,
      }
    : null

  const dataQuery = useQuery({
    queryKey: ['salesReports', 'data', selectedReportId, filters, drillInput],
    queryFn: () => getReportData(selectedReportId as string, filters, drillInput ?? undefined),
    enabled:
      !!selectedReportId &&
      canReadReport &&
      canReadDeals &&
      selectedReport?.isSupported !== false &&
      // Story 6.3 (AC 12): CUSTOM rows are never dispatched to getReportData —
      // they navigate to the builder instead.
      selectedReport?.type !== 'CUSTOM',
  })

  // ─── Realtime (AC 76): existing subscription invalidates data keys only ──
  const handleDealUpdate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['salesReports', 'data'] })
  }, [queryClient])

  useEffect(() => {
    if (connectGuardRef.current) return
    connectGuardRef.current = true

    const client = new GraphqlSubscriptionClient()
    clientRef.current = client
    client.connect()
    client.subscribe('onDealUpdated', {
      query: ON_DEAL_UPDATED_SUBSCRIPTION,
      variables: {},
      onData: handleDealUpdate,
    })

    return () => {
      connectGuardRef.current = false
      client.disconnect()
      clientRef.current = null
    }
  }, [handleDealUpdate])

  const canView = canReadReport && canReadDeals

  // ─── Permission gate (AC 67) ─────────────────────────────────────────
  if (!canView) {
    return (
      <PermissionLimitedState
        title="Reports access limited"
        message="Sales reports require both REPORT:READ and DEAL:READ permissions."
        requiredPermission="reports:read"
      />
    )
  }

  const data = dataQuery.data

  function selectReport(report: ReportRow): void {
    // Story 6.3 (AC 12): custom reports open in the builder editor instead of
    // being dispatched to getReportData.
    if (report.type === 'CUSTOM') {
      router.push(`/reports/builder?reportId=${report.id}`)
      return
    }
    setSelectedReportId(report.id)
    setDrill(null)
    setDrillPage(1)
    setDrillScope('CURRENT')
    if (!report.isSupported) {
      toast.error('This saved report has an unsupported type and cannot be run')
    }
  }

  function clearFilters(): void {
    setFilters({})
  }

  function handleBucketDrill(bucketKey: string): void {
    if (!selectedReport) return
    setDrill({
      metricKey: PRIMARY_DRILL_METRIC[selectedReport.type as ReportType] ?? 'WON_DEALS',
      bucketKey,
    })
    setDrillPage(1)
    // AC 53: a new drill always starts on the current scope.
    setDrillScope('CURRENT')
  }

  function handleMetricDrill(metric: ReportMetric): void {
    setDrill({ metricKey: metric.key })
    setDrillPage(1)
    // AC 53: a new drill always starts on the current scope.
    setDrillScope('CURRENT')
  }

  const drillConnection = data?.drillDown ?? null

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-[22px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
            Sales reports
          </h1>
          <p className="max-w-[56ch] text-[13.5px] text-[#77777f]">
            Saved, filterable reports with drill-down and comparative analysis.
            {data?.mixedCurrencies
              ? ' Mixed currencies detected — money values are hidden until a single currency is selected.'
              : ''}
          </p>
        </div>
        {canCreateReport ? (
          <Button
            onClick={() => {
              setEditingReport(null)
              setDialogOpen(true)
            }}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New report
          </Button>
        ) : null}
      </div>

      {reportsQuery.isLoading ? (
        <LoadingSkeleton />
      ) : reportsQuery.isError ? (
        <ErrorState
          message={(reportsQuery.error as Error).message || 'Could not load saved reports'}
          onRetry={() => reportsQuery.refetch()}
        />
      ) : reportsQuery.data && reportsQuery.data.items.length === 0 ? (
        <EmptyState
          title="No saved reports yet"
          description="Create your first report from a template or run one of the report types below."
          action={
            canCreateReport ? (
              <Button
                onClick={() => {
                  setEditingReport(null)
                  setDialogOpen(true)
                }}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                New report
              </Button>
            ) : null
          }
          icon={<BarChart3 aria-hidden="true" className="h-6 w-6" />}
        />
      ) : (
        <section
          aria-label="Saved reports"
          className="rounded-[14px] border border-[#ececf0] bg-white p-[18px]"
        >
          <div className="flex flex-wrap items-center gap-2">
            {reportsQuery.data?.items.map((report) => {
              const active = report.id === selectedReportId
              return (
                <button
                  key={report.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectReport(report)}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-[9px] border px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f] ${
                    active
                      ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                      : 'border-[#e6e6eb] bg-[#fafafb] text-[#4b4b55] hover:bg-[#f0f0f3]'
                  }`}
                >
                  {report.name}
                  {report.type === 'CUSTOM' ? (
                    <span className="rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-2 py-0.5 text-[11px] font-semibold text-[#7c3aed]">
                      Custom
                    </span>
                  ) : null}
                  {!report.isSupported ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Unsupported type
                    </span>
                  ) : null}
                  {report.isPublic ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-[#77777f]">
                      Public
                    </span>
                  ) : null}
                </button>
              )
            })}
            {reportsQuery.data &&
            reportsQuery.data.page < Math.ceil(reportsQuery.data.total / 20) ? (
              <Button variant="outline" size="sm" onClick={() => setListPage((p) => p + 1)}>
                More
              </Button>
            ) : null}
            {listPage > 1 ? (
              <Button variant="outline" size="sm" onClick={() => setListPage((p) => p - 1)}>
                Back
              </Button>
            ) : null}
          </div>

          {selectedReport && canUpdateReport ? (
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingReport(selectedReport)
                  setDialogOpen(true)
                }}
              >
                Edit
              </Button>
            </div>
          ) : null}
        </section>
      )}

      {/* ─── Report-type template picker (AC 66) ───────────────────────── */}
      {canCreateReport ? (
        <section
          aria-label="New report templates"
          className="rounded-[14px] border border-[#ececf0] bg-white p-[18px]"
        >
          <h2 className="mb-3 text-[15px] font-semibold text-[#1b1b1f]">Start from a template</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {REPORT_TYPE_TEMPLATES.map((template) => (
              <button
                key={template.type}
                type="button"
                onClick={() => {
                  setEditingReport(null)
                  setDialogOpen(true)
                }}
                className="flex min-h-[64px] flex-col items-start gap-1 rounded-[10px] border border-[#e6e6eb] bg-[#fafafb] px-3.5 py-3 text-left transition-colors hover:border-[#1b1b1f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
              >
                <span className="text-[13px] font-semibold text-[#1b1b1f]">{template.label}</span>
                <span className="text-[12px] text-[#8c8c96]">{template.description}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedReport ? (
        <>
          {/* ─── Filter toolbar (AC 68) ─────────────────────────────────── */}
          <section
            aria-label="Report filters"
            className="rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4"
          >
            <div className="flex flex-wrap items-end gap-3.5">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[#8c8c96]">Preset</span>
                <select
                  value={filters.datePreset ?? selectedReport.config?.datePreset}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      datePreset: e.target.value as ReportFilters['datePreset'],
                    }))
                  }
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="THIS_MONTH">This month</option>
                  <option value="THIS_QUARTER">This quarter</option>
                  <option value="THIS_YEAR">This year</option>
                  <option value="CUSTOM">Custom range</option>
                </select>
              </label>
              {(filters.datePreset ?? selectedReport.config?.datePreset) === 'CUSTOM' ? (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-medium text-[#8c8c96]">Start</span>
                    <input
                      type="date"
                      value={filters.startDate ?? selectedReport.config?.startDate ?? ''}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, startDate: e.target.value || null }))
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-medium text-[#8c8c96]">End</span>
                    <input
                      type="date"
                      value={filters.endDate ?? selectedReport.config?.endDate ?? ''}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, endDate: e.target.value || null }))
                      }
                      className={fieldClass}
                    />
                  </label>
                </>
              ) : null}
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[#8c8c96]">Comparison</span>
                <select
                  value={filters.comparisonMode ?? selectedReport.config?.comparisonMode}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      comparisonMode: e.target.value as ReportFilters['comparisonMode'],
                    }))
                  }
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="NONE">No comparison</option>
                  <option value="PREVIOUS_PERIOD">Previous period</option>
                  <option value="YEAR_OVER_YEAR">Year over year</option>
                  <option value="CUSTOM">Custom dates</option>
                </select>
              </label>
              {(filters.comparisonMode ?? selectedReport.config?.comparisonMode) === 'CUSTOM' ? (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-medium text-[#8c8c96]">
                      Comparison start
                    </span>
                    <input
                      type="date"
                      value={
                        filters.comparisonStartDate ??
                        selectedReport.config?.comparisonStartDate ??
                        ''
                      }
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, comparisonStartDate: e.target.value || null }))
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-medium text-[#8c8c96]">Comparison end</span>
                    <input
                      type="date"
                      value={
                        filters.comparisonEndDate ?? selectedReport.config?.comparisonEndDate ?? ''
                      }
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, comparisonEndDate: e.target.value || null }))
                      }
                      className={fieldClass}
                    />
                  </label>
                </>
              ) : null}
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[#8c8c96]">Group by</span>
                <select
                  value={filters.groupBy ?? selectedReport.config?.groupBy}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, groupBy: e.target.value as ReportGroupBy }))
                  }
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="MONTH">Month</option>
                  <option value="QUARTER">Quarter</option>
                  <option value="YEAR">Year</option>
                  <option value="OWNER">Owner</option>
                  <option value="TEAM">Team</option>
                  <option value="PRODUCT">Product</option>
                </select>
              </label>
              {!usersQuery.isError ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-[#8c8c96]">Owner</span>
                  <select
                    value={filters.ownerId ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, ownerId: e.target.value || null }))}
                    className={`${fieldClass} min-w-[150px] cursor-pointer`}
                  >
                    <option value="">All owners</option>
                    {(usersQuery.data?.items ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!teamsQuery.isError ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-[#8c8c96]">Team</span>
                  <select
                    value={filters.teamId ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, teamId: e.target.value || null }))}
                    className={`${fieldClass} cursor-pointer`}
                  >
                    <option value="">All teams</option>
                    {(teamsQuery.data ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[#8c8c96]">Stage</span>
                <select
                  value={filters.stageId ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, stageId: e.target.value || null }))}
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="">All stages</option>
                  {(stagesQuery.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[#8c8c96]">Product</span>
                <select
                  value={filters.productId ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value || null }))}
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="">All products</option>
                  {(productsQuery.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[#8c8c96]">Currency</span>
                <select
                  value={filters.currency ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, currency: e.target.value || null }))}
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="">Auto</option>
                  {(data?.availableCurrencies ?? []).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              {Object.keys(filters).length > 0 ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                  Clear filters
                </button>
              ) : null}
            </div>
          </section>

          {/* ─── Data states (AC 67/78) ─────────────────────────────────── */}
          {dataQuery.isLoading && !dataQuery.data ? (
            <LoadingSkeleton />
          ) : dataQuery.isError ? (
            <ErrorState
              title="Could not run report"
              message={(dataQuery.error as Error).message || 'Something went wrong'}
              onRetry={() => dataQuery.refetch()}
            />
          ) : data ? (
            <>
              {/* ─── Summary metrics (AC 71) ─────────────────────────────── */}
              <section aria-label="Report summary">
                <MetricsCards
                  isLoading={false}
                  metrics={data.current.metrics.map((metric) => ({
                    label: metric.label,
                    value: metricDisplay(metric, data.currency),
                  }))}
                />
                {/* Trend text + icon row — never color alone (AC 71). */}
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2" aria-label="Trends">
                  {data.current.metrics
                    .filter((m) => changePresentation(m).label !== '—')
                    .map((metric) => (
                      <button
                        key={metric.key}
                        type="button"
                        onClick={() => handleMetricDrill(metric)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 text-[12.5px] text-[#4b4b55] hover:text-[#1b1b1f]"
                        aria-label={`${metric.label}: ${changePresentation(metric).label} — view underlying deals`}
                      >
                        <span className="font-medium">{metric.label}:</span>
                        <TrendBadge metric={metric} />
                      </button>
                    ))}
                </div>
              </section>

              {/* ─── Chart (AC 72-73) ───────────────────────────────────── */}
              <SalesReportChart
                title={`${data.current.metrics[0]?.label ?? 'Trend'} by ${(data.appliedFilters.groupBy ?? 'MONTH').toLowerCase()}`}
                ariaLabel={`${data.current.metrics[0]?.label ?? 'Report'} chart with ${data.current.buckets.length} data points`}
                series={chartSeries(data.current.buckets, data.currency)}
                onDrill={handleBucketDrill}
              />

              {/* ─── Stage breakdown (AC 32-33) ─────────────────────────── */}
              {data.current.stageBreakdown.length > 0 ? (
                <section
                  aria-label="Stage breakdown"
                  className="rounded-[14px] border border-[#ececf0] bg-white p-[18px]"
                >
                  <h3 className="text-[15px] font-semibold text-[#1b1b1f]">Stage breakdown</h3>
                  <p className="mt-1 text-[12px] text-[#8c8c96]">{data.calculationNote}</p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-[13px]">
                      <caption className="sr-only">Stage breakdown</caption>
                      <thead>
                        <tr className="border-b border-[#ececf0] text-[11.5px] uppercase tracking-wide text-[#8c8c96]">
                          <th scope="col" className="px-3 py-2 font-medium">
                            Stage
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Deals
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Share
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.current.stageBreakdown.map((stage) => (
                          <tr
                            key={stage.stageId}
                            className="border-b border-[#f0f0f3] last:border-0"
                          >
                            <td className="px-3 py-2.5">
                              <span className="inline-flex items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: stage.color }}
                                />
                                {stage.stageName}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">{stage.dealCount}</td>
                            <td className="px-3 py-2.5">{formatPercent(stage.stageSharePct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <p className="text-[12px] text-[#8c8c96]">
                Generated {new Date(data.generatedAt).toLocaleString()} · {data.dateField} date
                semantics · {data.currency ?? 'no single currency'}
              </p>
            </>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="Select a saved report"
          description="Pick a report above to see its data, or create a new one from a template."
          icon={<CalendarDays aria-hidden="true" className="h-6 w-6" />}
        />
      )}

      <SalesReportDrillDown
        open={!!drill}
        onOpenChange={(open) => {
          if (!open) setDrill(null)
        }}
        metricLabel={drill?.metricKey ?? ''}
        currency={data?.currency ?? null}
        drill={drillConnection}
        isLoading={dataQuery.isLoading}
        error={dataQuery.isError ? (dataQuery.error as Error).message : null}
        scope={drillScope}
        onScopeChange={setDrillScope}
        onPageChange={setDrillPage}
        hasComparison={data?.comparison !== null && data?.comparison !== undefined}
      />

      <SavedReportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        report={editingReport}
        canDelete={canDeleteReport}
        onSaved={(saved) => {
          if (saved?.id) {
            setSelectedReportId(saved.id)
            setDrill(null)
          }
        }}
      />
    </div>
  )
}
