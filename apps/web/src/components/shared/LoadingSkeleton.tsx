import { Skeleton } from '@/components/ui/skeleton'

interface TableSkeletonProps {
  rows?: number
  columns?: number
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps): React.JSX.Element {
  const safeRows = Math.max(rows, 1)
  const safeColumns = Math.max(columns, 1)

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading table data"
      className="rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      {/* Header row */}
      <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {Array.from({ length: safeColumns }).map((_, index) => (
          <Skeleton key={`header-${index}`} className="h-3 w-1/3" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: safeRows }).map((_, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className="flex items-center gap-4 border-b border-slate-100 px-4 py-3"
        >
          {Array.from({ length: safeColumns }).map((_, colIndex) => (
            <Skeleton key={`cell-${rowIndex}-${colIndex}`} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading card"
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <Skeleton className="mb-4 h-5 w-2/3" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

export function DashboardSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Loading dashboard" className="space-y-6">
      {/* Metric strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`metric-${index}`}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <Skeleton className="mb-3 h-3 w-1/3" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        ))}
      </div>
      {/* 2-column grid with card skeletons */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Skeleton className="mb-4 h-5 w-1/3" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Skeleton className="mb-4 h-5 w-1/3" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  )
}

export function DetailSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Loading detail" className="space-y-6">
      {/* Header block */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Skeleton className="mb-2 h-4 w-24" />
        <Skeleton className="h-8 w-1/2" />
      </div>
      {/* 2-column fields */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`field-${index}`}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <Skeleton className="mb-2 h-3 w-1/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function FormSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Loading form" className="space-y-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={`field-${index}`} className="space-y-2">
          <Skeleton className="h-3 w-1/5" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}

export function LoadingSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Loading content" className="space-y-4">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}
