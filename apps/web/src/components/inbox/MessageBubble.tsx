import { cn } from '@/lib/utils'
import type { Message } from '@/services/inbox.service'
import { Check, CheckCheck } from 'lucide-react'

type MessageBubbleProps = {
  message: Message
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}d`
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const isAgent = message.senderType === 'AGENT'
  const isSystem = message.senderType === 'SYSTEM'

  if (isSystem) {
    return (
      <div className="flex justify-center py-4">
        <span className="rounded-full bg-slate-100/80 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500 shadow-sm backdrop-blur-sm border border-slate-200/50">
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('flex w-full group mb-1.5', isAgent ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative max-w-[75%] px-4 py-3 transition-all hover:shadow-sm',
          isAgent
            ? 'rounded-2xl rounded-tr-sm bg-indigo-50 text-indigo-950'
            : 'rounded-2xl rounded-tl-sm bg-white border border-slate-100 text-slate-800 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)]',
        )}
      >
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
          {message.content}
        </p>
        <div
          className={cn(
            'mt-1.5 flex items-center gap-1.5',
            isAgent ? 'justify-end' : 'justify-start',
          )}
        >
          <span
            className={cn(
              'text-[10px] font-medium leading-none tracking-tight',
              isAgent ? 'text-indigo-400' : 'text-slate-400',
            )}
          >
            {timeAgo(message.sentAt)}
          </span>
          {isAgent && (
            <span className="flex items-center">
              {message.readAt ? (
                <CheckCheck className="h-[14px] w-[14px] text-indigo-400" strokeWidth={2.5} />
              ) : message.deliveredAt ? (
                <CheckCheck className="h-[14px] w-[14px] text-indigo-300" strokeWidth={2.5} />
              ) : (
                <Check className="h-[14px] w-[14px] text-indigo-300" strokeWidth={2.5} />
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
