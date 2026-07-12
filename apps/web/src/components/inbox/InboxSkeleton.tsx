import { cn } from '@/lib/utils'

export function InboxSkeleton({
  className,
  variant = 'list',
}: {
  className?: string
  variant?: 'list' | 'detail'
}): React.JSX.Element {
  if (variant === 'detail') {
    return (
      <div
        className={cn(
          'flex flex-col gap-6 p-4 w-full max-w-3xl mx-auto animate-pulse mt-4',
          className,
        )}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cn('flex w-full', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
            <div
              className={cn(
                'h-16 w-64 rounded-2xl bg-slate-200/60 shadow-sm',
                i % 2 === 0 ? 'rounded-tl-[4px]' : 'rounded-tr-[4px]',
              )}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col w-full animate-pulse gap-1', className)}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <div className="h-12 w-12 flex-shrink-0 rounded-full bg-slate-200/60" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <div className="flex items-center justify-between">
              <div className="h-4 w-32 rounded bg-slate-200/60" />
              <div className="h-3 w-12 rounded bg-slate-200/60" />
            </div>
            <div className="h-3 w-3/4 rounded bg-slate-200/60" />
          </div>
        </div>
      ))}
    </div>
  )
}
