import { cn } from '@/lib/utils'

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('animate-pulse rounded-md bg-slate-200', className)} {...props} />
}

function SkeletonText({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <Skeleton className={cn('h-4 w-full', className)} {...props} />
}

function SkeletonHeading({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <Skeleton className={cn('h-6 w-1/3', className)} {...props} />
}

function SkeletonCard({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn('rounded-xl border border-slate-200 bg-white p-6 shadow-sm', className)}
      {...props}
    >
      <Skeleton className="mb-4 h-5 w-2/3" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

interface SkeletonTableRowProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: number
}

function SkeletonTableRow({
  columns = 4,
  className,
  ...props
}: SkeletonTableRowProps): React.ReactElement {
  return (
    <div className={cn('flex items-center gap-4 px-4 py-3', className)} {...props}>
      {Array.from({ length: columns }).map((_, index) => (
        <Skeleton key={index} className="h-4 flex-1" />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonText, SkeletonHeading, SkeletonCard, SkeletonTableRow }
