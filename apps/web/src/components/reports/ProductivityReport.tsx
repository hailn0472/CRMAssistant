'use client'

import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { getProductivityReport } from '@/services/productivity.service'
import type { ProductivityBucket, ProductivityReportFilter } from '@/services/productivity.service'
import { searchUsers } from '@/services/owner.service'
import { useMyPermissions } from '@/hooks/usePermission'
import { useDebounce } from '@/hooks/useDebounce'
import { MetricsCards } from '@/components/shared/MetricsCards'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { ErrorState } from '@/components/shared/ErrorState'
import { EmptyState } from '@/components/shared/EmptyState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { formatDurationShort } from '@/lib/time-format'
import {
  formatDateInput,
  startOfCurrentQuarterUtc,
  startOfCurrentYearUtc,
  startOfLast30DaysUtc,
  todayUtc,
} from '@/lib/win-loss-format'
import { cn } from '@/lib/utils'

// React.lazy + Suspense keeps recharts out of the initial bundle of a page
// whose most common first render may be an empty state
// (docs/rules/react-nextjs-rules.md:309).
const TimeDistributionChart = lazy(() =>
  import('./TimeDistributionChart').then((m) => ({ default: m.TimeDistributionChart })),
)
const DailyTimeChart = lazy(() =>
  import('./DailyTimeChart').then((m) => ({ default: m.DailyTimeChart })),
)

const QUICK_RANGES = [
  { label: 'Last 30 days', start: startOfLast30DaysUtc },
  { label: 'This quarter', start: startOfCurrentQuarterUtc },
  { label: 'This year', start: startOfCurrentYearUtc },
] as const

const BUCKET_OPTIONS: { value: ProductivityBucket; label: string }[] = [
  { value: 'DAY', label: 'Day' },
  { value: 'WEEK', label: 'Week' },
  { value: 'MONTH', label: 'Month' },
]

export function ProductivityReport(): React.JSX.Element {
  // useMyPermissions (not usePermission) so the gate can distinguish
  // "still loading" from "denied" — showing PermissionLimitedState during
  // the permissions fetch flashes "Access limited" to users who DO have
  // access (house pattern: ProductsManager renders a skeleton while loading).
  const { hasPermission, isLoading: permissionsLoading } = useMyPermissions()
  const canSeeReport = hasPermission('REPORT', 'READ')
  // The user picker only makes sense for callers who can see more than
  // themselves — USER:READ is granted to ADMIN/SALES_MANAGER only, i.e. the
  // roles whose report scope can cover other users (AC 40).
  const canSeeOtherUsers = hasPermission('USER', 'READ')

  const [startDate, setStartDate] = useState(() => formatDateInput(startOfCurrentQuarterUtc()))
  const [endDate, setEndDate] = useState(() => formatDateInput(todayUtc()))
  const [bucket, setBucket] = useState<ProductivityBucket>('DAY')
  const [userId, setUserId] = useState<string | null>(null)

  const filter: ProductivityReportFilter = {
    startDate,
    endDate,
    bucket,
    userId: userId ?? undefined,
  }

  const reportQuery = useQuery({
    queryKey: ['productivity', filter],
    queryFn: () => getProductivityReport(filter),
    enabled: canSeeReport,
  })

  const today = formatDateInput(todayUtc())
  const isLoading = reportQuery.isLoading
  const error = reportQuery.error
  const report = reportQuery.data

  function selectQuickRange(start: (now?: Date) => Date): void {
    setStartDate(formatDateInput(start()))
    setEndDate(formatDateInput(todayUtc()))
  }

  if (permissionsLoading) {
    // Permissions still resolving — skeleton, NOT PermissionLimitedState
    // (the loading flash bug: a user with access briefly saw "Access limited").
    return (
      <div className="mx-auto w-full max-w-[1240px]">
        <LoadingSkeleton />
      </div>
    )
  }

  if (!canSeeReport) {
    return (
      <div className="mx-auto w-full max-w-[1240px]">
        <PermissionLimitedState
          message="You need the Reports permission to view the productivity report."
          requiredPermission="reports:read"
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-[18px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
          Productivity
        </h1>
        <p className="max-w-[60ch] text-[13.5px] text-[#77777f]">
          Time tracked against tasks, by person and by day. All times are UTC — there is no per-user
          timezone.
        </p>
      </div>

      {/* Filter bar */}
      <section
        aria-label="Productivity Report Filters"
        className="flex flex-wrap items-end gap-3.5 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">Start Date</span>
          <input
            id="productivity-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f] focus:bg-white"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[#8c8c96]">End Date</span>
          <input
            id="productivity-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f] focus:bg-white"
          />
        </label>
        <div className="flex items-center gap-1.5 pb-px">
          {QUICK_RANGES.map((range) => {
            const active = startDate === formatDateInput(range.start()) && endDate === today
            return (
              <button
                key={range.label}
                type="button"
                onClick={() => selectQuickRange(range.start)}
                className={cn(
                  'h-9 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                  active
                    ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                    : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:border-[#c7c7d1]',
                )}
              >
                {range.label}
              </button>
            )
          })}
        </div>
        <BucketToggle bucket={bucket} onChange={setBucket} />
        {canSeeOtherUsers ? <UserPicker userId={userId} onSelect={setUserId} /> : null}
      </section>

      <p className="text-[12px] text-[#8c8c96]">All times are UTC.</p>

      {/* Loading */}
      {isLoading && <LoadingSkeleton />}

      {/* Error */}
      {error && !isLoading && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Failed to load productivity report'}
          onRetry={() => reportQuery.refetch()}
        />
      )}

      {/* Empty */}
      {!isLoading && !error && report && report.totalSeconds === 0 && (
        <EmptyState
          title="No time tracked in this range"
          description="Start the timer on a task or add time manually, then come back here."
        />
      )}

      {/* Data */}
      {!isLoading && !error && report && report.totalSeconds > 0 && (
        <>
          <MetricsCards
            variant="divide"
            isLoading={false}
            metrics={[
              { label: 'Total time tracked', value: formatDurationShort(report.totalSeconds) },
              { label: 'Entries', value: String(report.entryCount) },
              { label: 'Days tracked', value: String(report.trackedDays) },
              {
                label: 'Avg per tracked day',
                value: formatDurationShort(Math.round(report.averageSecondsPerTrackedDay)),
              },
            ]}
          />
          <div className="grid grid-cols-1 items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
            <Suspense fallback={<LoadingSkeleton />}>
              <TimeDistributionChart byTask={report.byTask} />
            </Suspense>
            <Suspense fallback={<LoadingSkeleton />}>
              <DailyTimeChart buckets={report.buckets} bucket={report.bucket} />
            </Suspense>
          </div>
        </>
      )}
    </div>
  )
}

function BucketToggle({
  bucket,
  onChange,
}: {
  bucket: ProductivityBucket
  onChange: (bucket: ProductivityBucket) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 pb-px" role="group" aria-label="Bucket">
      {BUCKET_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={bucket === option.value}
          className={cn(
            'h-9 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
            bucket === option.value
              ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
              : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:border-[#c7c7d1]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function UserPicker({
  userId,
  onSelect,
}: {
  userId: string | null
  onSelect: (userId: string | null) => void
}): React.JSX.Element {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const debouncedTerm = useDebounce(term, 300)

  const { data: users = [] } = useQuery({
    queryKey: ['productivity-user-options', debouncedTerm],
    queryFn: () => searchUsers(debouncedTerm),
    enabled: open,
  })

  return (
    <div className="relative pb-px">
      <button
        type="button"
        aria-label="Choose whose report to view"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#e6e6eb] bg-white px-3 text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
      >
        {userId ? 'Someone else' : 'My time'}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-1.5 w-64 rounded-[12px] border border-[#ececf0] bg-white p-2 shadow-lg">
          <input
            aria-label="Search people"
            placeholder="Search people..."
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="h-8 w-full rounded-[8px] border border-[#e6e6eb] bg-[#fafafb] px-2.5 text-[12.5px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f] focus:bg-white"
          />
          <div className="mt-1.5 max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onSelect(null)
                setOpen(false)
              }}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-[#1b1b1f] transition-colors hover:bg-[#f4f4f6]"
            >
              My time
            </button>
            {users.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-[#a0a0aa]">No people found.</p>
            ) : (
              users.map((user) => {
                const name = `${user.firstName} ${user.lastName}`.trim()
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      onSelect(user.id)
                      setOpen(false)
                    }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-[#1b1b1f] transition-colors hover:bg-[#f4f4f6]"
                  >
                    <span className="truncate">{name || user.email}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
