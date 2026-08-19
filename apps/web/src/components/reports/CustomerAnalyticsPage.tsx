'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Filter, RefreshCw, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  LoadingSkeleton,
  EmptyState,
  ErrorState,
  PermissionLimitedState,
} from '@/components/shared'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { useMyPermissions } from '@/hooks/usePermission'
import { ReportChart } from '@/components/reports/charting/ReportChart'
import {
  customerAnalyticsKeys,
  getCustomerAnalytics,
  type CustomerAnalyticsFilterInput,
  type CustomerChurnRisk,
} from '@/services/customer-analytics.service'
import {
  buildChurnDistributionChartData,
  buildCohortChartData,
  buildLtvDistributionChartData,
  buildLtvTrendChartData,
  formatCustomerLtv,
  formatRiskScore,
  getChurnRiskBadgeDetails,
  validateAnalyticsFilterRange,
} from '@/lib/customer-analytics'

export function CustomerAnalyticsPage(): React.JSX.Element {
  const { hasPermission, isLoading: isPermissionLoading } = useMyPermissions()

  const canReadReport = hasPermission('REPORT', 'READ')
  const canReadContact = hasPermission('CONTACT', 'READ')
  const canReadDeal = hasPermission('DEAL', 'READ')
  const hasAccess = canReadReport && canReadContact && canReadDeal

  // Filter state
  const [minLtvInput, setMinLtvInput] = useState('')
  const [maxLtvInput, setMaxLtvInput] = useState('')
  const [selectedRisks, setSelectedRisks] = useState<CustomerChurnRisk[]>(['LOW', 'MEDIUM', 'HIGH'])
  const [fromDateInput, setFromDateInput] = useState('')
  const [toDateInput, setToDateInput] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [ownerInput, setOwnerInput] = useState('')
  const [filterValidationError, setFilterValidationError] = useState<string | null>(null)

  // Applied query filters
  const [appliedFilters, setAppliedFilters] = useState<CustomerAnalyticsFilterInput>({
    minLifetimeValue: null,
    maxLifetimeValue: null,
    churnRisks: ['LOW', 'MEDIUM', 'HIGH'],
    lastActivityFrom: null,
    lastActivityTo: null,
    search: null,
    ownerId: null,
  })

  // Pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // Accessible announce state
  const [liveAnnouncement, setLiveAnnouncement] = useState('')

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: customerAnalyticsKeys.list(appliedFilters, { page, pageSize }),
    queryFn: () => getCustomerAnalytics(appliedFilters, { page, pageSize }),
    enabled: hasAccess,
    staleTime: 60 * 1000,
  })

  const summary = data?.summary
  const customers = data?.customers?.items ?? []
  const totalCustomers = data?.customers?.total ?? 0
  const isMixedCurrencies = summary?.mixedCurrencies ?? false

  // Derive sole display currency ONLY when !mixedCurrencies and exactly one currency breakdown item
  const displayCurrency: string | null =
    !isMixedCurrencies && summary?.currencyBreakdown && summary.currencyBreakdown.length === 1
      ? summary.currencyBreakdown[0].currency
      : null

  const ltvDistChart = useMemo(() => {
    if (!data?.ltvDistribution) return null
    return buildLtvDistributionChartData(data.ltvDistribution)
  }, [data?.ltvDistribution])

  const churnDistChart = useMemo(() => {
    if (!data?.churnRiskDistribution) return null
    return buildChurnDistributionChartData(data.churnRiskDistribution)
  }, [data?.churnRiskDistribution])

  const ltvTrendChart = useMemo(() => {
    if (!data?.ltvTrend) return null
    return buildLtvTrendChartData(data.ltvTrend, isMixedCurrencies, displayCurrency)
  }, [data?.ltvTrend, isMixedCurrencies, displayCurrency])

  const cohortChart = useMemo(() => {
    if (!data?.cohorts) return null
    return buildCohortChartData(data.cohorts, isMixedCurrencies, displayCurrency)
  }, [data?.cohorts, isMixedCurrencies, displayCurrency])

  const handleApplyFilters = (): void => {
    let minVal: number | null = null
    let maxVal: number | null = null

    if (minLtvInput.trim() !== '') {
      minVal = Number(minLtvInput)
    }
    if (maxLtvInput.trim() !== '') {
      maxVal = Number(maxLtvInput)
    }

    const validationErr = validateAnalyticsFilterRange({
      minLtv: minVal,
      maxLtv: maxVal,
      fromDate: fromDateInput || null,
      toDate: toDateInput || null,
    })

    if (validationErr) {
      setFilterValidationError(validationErr)
      return
    }

    setFilterValidationError(null)
    setPage(1)
    setAppliedFilters({
      minLifetimeValue: minVal,
      maxLifetimeValue: maxVal,
      churnRisks: selectedRisks.length > 0 ? selectedRisks : null,
      lastActivityFrom: fromDateInput || null,
      lastActivityTo: toDateInput || null,
      search: searchInput.trim() || null,
      ownerId: ownerInput.trim() || null,
    })
    setLiveAnnouncement('Filters applied. Refreshing customer analytics.')
  }

  const handleResetFilters = (): void => {
    setMinLtvInput('')
    setMaxLtvInput('')
    setSelectedRisks(['LOW', 'MEDIUM', 'HIGH'])
    setFromDateInput('')
    setToDateInput('')
    setSearchInput('')
    setOwnerInput('')
    setFilterValidationError(null)
    setPage(1)
    setAppliedFilters({
      minLifetimeValue: null,
      maxLifetimeValue: null,
      churnRisks: ['LOW', 'MEDIUM', 'HIGH'],
      lastActivityFrom: null,
      lastActivityTo: null,
      search: null,
      ownerId: null,
    })
    setLiveAnnouncement('Filters reset to default.')
  }

  const toggleRiskSelection = (risk: CustomerChurnRisk): void => {
    setSelectedRisks((prev) =>
      prev.includes(risk) ? prev.filter((r) => r !== risk) : [...prev, risk],
    )
  }

  // 1. Permission loading gate
  if (isPermissionLoading) {
    return (
      <div
        data-testid="customer-analytics-loading-skeleton"
        className="space-y-6 p-4 sm:p-6 lg:p-8"
      >
        <LoadingSkeleton />
      </div>
    )
  }

  // 2. Permission denied gate
  if (!hasAccess) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PermissionLimitedState
          title="Truy cập bị giới hạn quyền"
          message="Yêu cầu đồng thời các quyền: REPORT:READ, CONTACT:READ và DEAL:READ để xem báo cáo phân tích khách hàng."
        />
      </div>
    )
  }

  // 3. Initial Query loading skeleton
  if (isLoading) {
    return (
      <div
        data-testid="customer-analytics-loading-skeleton"
        className="space-y-6 p-4 sm:p-6 lg:p-8"
      >
        <LoadingSkeleton />
      </div>
    )
  }

  // 4. Query error state
  if (isError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <ErrorState
          title="Không thể tải dữ liệu Customer Analytics"
          message={error instanceof Error ? error.message : 'Lỗi kết nối máy chủ.'}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize))

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 p-3 sm:p-6 lg:p-8">
      {/* Polite live region for screen-reader announcements */}
      <div className="sr-only" aria-live="polite" role="status">
        {liveAnnouncement}
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#ececf0] pb-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#1b1b1f] sm:text-[27px]">
            Customer Analytics & Churn Risk
          </h1>
          <p className="max-w-[70ch] text-[13.5px] text-[#77777f]">
            Phân tích giá trị vòng đời khách hàng (LTV) và dự báo rủi ro rời bỏ (Churn Risk) cập
            nhật hàng ngày.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex min-h-11 items-center gap-2 px-3 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>{isFetching ? 'Đang cập nhật…' : 'Làm mới'}</span>
          </Button>
        </div>
      </div>

      {/* Persistent Mixed Currency Warning (Story 6.7 AC 31, 42) */}
      {isMixedCurrencies && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50/70 p-4 shadow-sm"
        >
          <div className="flex items-start gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-amber-900">
                  Phát hiện nhiều loại tiền tệ (Mixed Currencies — No FX Conversion)
                </h2>
                <span className="rounded bg-amber-200/70 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-800">
                  No FX rule
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Các deal Closed-Won của khách hàng thuộc nhiều loại tiền tệ khác nhau. Hệ thống
                không áp dụng tỷ giá quy đổi giả định. Tổng LTV và Average LTV bên dưới thể hiện số
                định danh trung lập hoặc theo từng loại tiền tệ.
              </p>
              {summary?.currencyBreakdown && summary.currencyBreakdown.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-amber-200/60 pt-2">
                  <span className="text-xs font-semibold text-amber-900">
                    Chi tiết theo loại tiền:
                  </span>
                  {summary.currencyBreakdown.map((cb) => (
                    <span
                      key={cb.currency}
                      className="inline-flex items-center gap-1 rounded border border-amber-200 bg-white/90 px-2 py-0.5 font-mono text-xs text-slate-800"
                    >
                      {cb.currency}: {cb.value.toLocaleString()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Summary Metric Cards */}
      <section aria-label="Customer Analytics Summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Total LTV */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-[#ececf0] bg-white p-4 shadow-sm">
            <span className="text-[11.5px] font-medium uppercase tracking-wider text-[#8c8c96]">
              Total LTV
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold tracking-tight text-[#1b1b1f] sm:text-[22px]">
                {formatCustomerLtv(summary?.totalLifetimeValue, isMixedCurrencies, displayCurrency)}
              </span>
              {displayCurrency && (
                <span className="text-[11px] font-medium text-slate-500">({displayCurrency})</span>
              )}
            </div>
            <span className="text-[11px] text-slate-400">Tổng giá trị Closed-Won deals</span>
          </div>

          {/* Card 2: Average LTV */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-[#ececf0] bg-white p-4 shadow-sm">
            <span className="text-[11.5px] font-medium uppercase tracking-wider text-[#8c8c96]">
              Avg LTV / Customer
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold tracking-tight text-[#1b1b1f] sm:text-[22px]">
                {formatCustomerLtv(
                  summary?.averageLifetimeValue,
                  isMixedCurrencies,
                  displayCurrency,
                )}
              </span>
              {displayCurrency && (
                <span className="text-[11px] font-medium text-slate-500">({displayCurrency})</span>
              )}
            </div>
            <span className="text-[11px] text-slate-400">
              {summary?.highLtvThreshold
                ? `Ngưỡng top 25% LTV: ≥ ${formatCustomerLtv(summary.highLtvThreshold, isMixedCurrencies, displayCurrency)}`
                : 'Trên active contacts'}
            </span>
          </div>

          {/* Card 3: Analyzed Customers */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-[#ececf0] bg-white p-4 shadow-sm">
            <span className="text-[11.5px] font-medium uppercase tracking-wider text-[#8c8c96]">
              Khách hàng đã phân tích
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-semibold tracking-tight text-[#1b1b1f] sm:text-[22px]">
                {summary?.calculatedCustomerCount ?? 0}
              </span>
              <span className="font-mono text-sm text-slate-500">
                / {summary?.customerCount ?? 0} tổng số
              </span>
            </div>
            <span className="text-[11px] text-slate-400">
              {summary?.latestCalculatedAt
                ? `Tính gần nhất: ${new Date(summary.latestCalculatedAt).toLocaleDateString()}`
                : 'Chờ daily background job tính'}
            </span>
          </div>

          {/* Card 4: High Churn Risk Count */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-rose-100 bg-rose-50/40 p-4 shadow-sm">
            <span className="text-[11.5px] font-medium uppercase tracking-wider text-rose-700">
              Rủi ro rời bỏ (High Risk)
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-semibold tracking-tight text-rose-600 sm:text-[22px]">
                {data?.churnRiskDistribution?.find((d) => d.risk === 'HIGH')?.count ?? 0}
              </span>
              <span className="font-mono text-sm text-slate-500">
                (
                {data?.churnRiskDistribution
                  ?.find((d) => d.risk === 'HIGH')
                  ?.percentage.toFixed(1) ?? '0.0'}
                %)
              </span>
            </div>
            <span className="text-[11px] text-rose-600 font-medium">
              Tự động tạo task cho Owner
            </span>
          </div>
        </div>
      </section>

      {/* 4 Analytical Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Chart 1: LTV Distribution */}
        <section
          aria-label="Phân bố LTV khách hàng"
          className="flex flex-col justify-between rounded-[14px] border border-[#ececf0] bg-white p-4 sm:p-5 shadow-sm"
        >
          <div className="space-y-3">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Phân bố LTV khách hàng</h2>
              <p className="text-xs text-[#8c8c96]">Số lượng khách hàng theo các khoảng LTV</p>
            </div>
            {ltvDistChart && <ReportChart chart={ltvDistChart} minHeight={240} />}
          </div>
        </section>

        {/* Chart 2: Churn Risk Distribution */}
        <section
          aria-label="Phân bố rủi ro rời bỏ"
          className="flex flex-col justify-between rounded-[14px] border border-[#ececf0] bg-white p-4 sm:p-5 shadow-sm"
        >
          <div className="space-y-3">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Phân loại rủi ro rời bỏ</h2>
              <p className="text-xs text-[#8c8c96]">
                Inactivity (40%) + Win Rate (30%) + Engagement (30%)
              </p>
            </div>
            {churnDistChart && <ReportChart chart={churnDistChart} minHeight={240} />}
          </div>
        </section>

        {/* Chart 3: Historical LTV Trend */}
        <section
          aria-label="Xu hướng LTV lịch sử"
          className="flex flex-col justify-between rounded-[14px] border border-[#ececf0] bg-white p-4 sm:p-5 shadow-sm"
        >
          <div className="space-y-3">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Xu hướng LTV lịch sử</h2>
              <p className="text-xs text-[#8c8c96]">
                Dữ liệu snapshot hàng ngày trong 90 ngày UTC gần nhất
              </p>
            </div>
            {ltvTrendChart && <ReportChart chart={ltvTrendChart} minHeight={240} />}
          </div>
        </section>

        {/* Chart 4: Acquisition Cohort Analysis */}
        <section
          aria-label="Phân tích Cohort ngày thu nhận"
          className="flex flex-col justify-between rounded-[14px] border border-[#ececf0] bg-white p-4 sm:p-5 shadow-sm"
        >
          <div className="space-y-3">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-[15px] font-semibold text-[#1b1b1f]">
                Phân tích Cohort thu nhận
              </h2>
              <p className="text-xs text-[#8c8c96]">
                Nhóm khách hàng theo tháng tạo Contact (YYYY-MM)
              </p>
            </div>
            {cohortChart && <ReportChart chart={cohortChart} minHeight={240} />}
          </div>
        </section>
      </div>

      {/* Filter Toolbar (AC 11, Contract E40) */}
      <section
        aria-label="Customer Filters"
        className="space-y-4 rounded-[14px] border border-[#ececf0] bg-white p-4 sm:p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-[#1b1b1f]">Bộ lọc khách hàng</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleResetFilters}
              className="min-h-11 px-3 text-xs text-slate-600 hover:text-slate-900"
            >
              Đặt lại bộ lọc
            </Button>
            <Button
              onClick={handleApplyFilters}
              className="min-h-11 bg-indigo-600 px-4 text-xs text-white hover:bg-indigo-700"
            >
              Áp dụng (Apply)
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Search */}
          <div className="space-y-1">
            <label htmlFor="filter-search" className="text-[11.5px] font-medium text-[#8c8c96]">
              Tìm kiếm tên / email
            </label>
            <div className="relative">
              <Input
                id="filter-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm kiếm tên..."
                className="min-h-11 pl-8 text-xs"
              />
              <Search className="absolute left-2.5 top-3.5 h-4 w-4 text-slate-400" />
            </div>
          </div>

          {/* LTV Range */}
          <div className="space-y-1">
            <span className="text-[11.5px] font-medium text-[#8c8c96]">Khoảng LTV</span>
            <div className="flex items-center gap-1.5">
              <label htmlFor="filter-min-ltv" className="sr-only">
                LTV tối thiểu
              </label>
              <Input
                id="filter-min-ltv"
                type="text"
                inputMode="numeric"
                placeholder="Min"
                value={minLtvInput}
                onChange={(e) => setMinLtvInput(e.target.value)}
                className="min-h-11 text-xs font-mono"
              />
              <span className="text-xs text-slate-400">—</span>
              <label htmlFor="filter-max-ltv" className="sr-only">
                LTV tối đa
              </label>
              <Input
                id="filter-max-ltv"
                type="text"
                inputMode="numeric"
                placeholder="Max"
                value={maxLtvInput}
                onChange={(e) => setMaxLtvInput(e.target.value)}
                className="min-h-11 text-xs font-mono"
              />
            </div>
          </div>

          {/* Churn Risk Multi-select */}
          <div className="space-y-1">
            <label className="text-[11.5px] font-medium text-[#8c8c96]">Mức rủi ro Churn</label>
            <div className="flex min-h-11 items-center justify-around rounded-[9px] border border-[#e6e6eb] bg-slate-50 px-2 text-xs">
              {(['LOW', 'MEDIUM', 'HIGH'] as CustomerChurnRisk[]).map((r) => (
                <label
                  key={r}
                  data-testid="risk-checkbox-label"
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1 px-1.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedRisks.includes(r)}
                    onChange={() => toggleRiskSelection(r)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="text-[11px] font-medium">{r}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Last Activity Dates */}
          <div className="space-y-1">
            <label className="text-[11.5px] font-medium text-[#8c8c96]">Hoạt động cuối</label>
            <div className="flex items-center gap-1">
              <Input
                type="date"
                aria-label="Từ ngày"
                value={fromDateInput}
                onChange={(e) => setFromDateInput(e.target.value)}
                className="min-h-11 text-[11px]"
              />
              <span className="text-xs text-slate-400">—</span>
              <Input
                type="date"
                aria-label="Đến ngày"
                value={toDateInput}
                onChange={(e) => setToDateInput(e.target.value)}
                className="min-h-11 text-[11px]"
              />
            </div>
          </div>

          {/* Owner ID */}
          <div className="space-y-1">
            <label htmlFor="filter-owner" className="text-[11.5px] font-medium text-[#8c8c96]">
              Owner ID
            </label>
            <Input
              id="filter-owner"
              value={ownerInput}
              onChange={(e) => setOwnerInput(e.target.value)}
              placeholder="e.g. user-1"
              className="min-h-11 text-xs font-mono"
            />
          </div>
        </div>

        {/* Validation error message banner */}
        {filterValidationError && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <span>{filterValidationError}</span>
          </div>
        )}
      </section>

      {/* Customer List Table (AC 11, 12, 13, Contract E41) */}
      <section
        aria-label="Customer Analytics Table"
        className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[#1b1b1f]">
              Danh sách phân tích khách hàng
            </h2>
            <p className="text-xs text-[#8c8c96]">Sắp xếp: Risk Score giảm dần, LTV giảm dần</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>Hiển thị mỗi trang:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="min-h-11 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </div>
        </div>

        {customers.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="Không tìm thấy khách hàng nào"
              description="Không có dữ liệu khách hàng nào khớp với điều kiện lọc hiện tại. Thử nới rộng bộ lọc."
            />
          </div>
        ) : (
          <ResponsiveTableWrapper>
            <table className="w-full min-w-[750px] border-collapse text-left text-[13px]">
              <caption className="sr-only">
                Danh sách khách hàng kèm điểm LTV, rủi ro Churn và hành động đề xuất
              </caption>
              <thead>
                <tr className="border-b border-[#ececf0] bg-[#fafafb] text-[11.5px] uppercase tracking-wider text-[#8c8c96]">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Khách hàng
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Người phụ trách
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Lifetime Value (LTV)
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Rủi ro Churn
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Hoạt động cuối
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Hành động đề xuất
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f3] text-slate-800">
                {customers.map((c) => {
                  const badge = getChurnRiskBadgeDetails(c.churnRisk)
                  const actionCode = c.recommendedAction?.code
                  const actionLabel = c.recommendedAction?.label ?? 'Monitor'

                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/contacts/${c.id}`}
                          className="text-indigo-600 hover:text-indigo-900 hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {c.ownerName || c.ownerId || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-slate-900">
                        {formatCustomerLtv(c.lifetimeValue, isMixedCurrencies, displayCurrency)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.colorClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${badge.dotColorClass}`} />
                          <span>{badge.label}</span>
                          {c.churnRiskScore !== null && (
                            <span className="ml-1 font-mono text-[10px]">
                              ({formatRiskScore(c.churnRiskScore)})
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">
                        {c.lastActivityDate
                          ? new Date(c.lastActivityDate).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/contacts/${c.id}`}
                          className={`inline-flex items-center gap-1 text-xs font-medium hover:underline ${
                            actionCode === 'SCHEDULE_FOLLOW_UP'
                              ? 'text-rose-600'
                              : actionCode === 'UPSELL_OPPORTUNITY'
                                ? 'text-indigo-600'
                                : 'text-slate-600'
                          }`}
                        >
                          <span>{actionLabel}</span>
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        )}

        {/* Pagination controls */}
        {customers.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-[#fafafb] px-5 py-3.5 text-xs text-slate-600">
            <div className="font-mono font-medium">
              Hiển thị {(page - 1) * pageSize + 1} – {Math.min(page * pageSize, totalCustomers)}{' '}
              trên tổng số {totalCustomers} khách hàng
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-11 px-3 text-xs"
              >
                Trang trước
              </Button>
              <span className="px-2 font-mono text-xs">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-11 px-3 text-xs"
              >
                Trang sau
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
