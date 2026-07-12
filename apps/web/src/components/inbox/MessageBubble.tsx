import { cn } from '@/lib/utils'
import type { Message } from '@/services/inbox.service'
import { Check, CheckCheck, Loader2 } from 'lucide-react'
import { InternalNoteBadge } from './InternalNoteBadge'

type MessageBubbleProps = {
  message: Message
  currentUserId?: string
  /** Whether this is the last message from the current user in the thread */
  isLastFromMe?: boolean
  /** Show Messenger-style "seen" avatar below the message */
  showSeenAvatar?: boolean
  /** Name of the person who saw the message (for avatar initials) */
  seenByName?: string
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

/**
 * Get the delivery status of a message, Messenger-style:
 * - 'sending'   → optimistic, not yet confirmed by server
 * - 'sent'      → server confirmed (has real ID), not delivered
 * - 'delivered' → recipient received it
 * - 'seen'      → recipient read it
 */
function getDeliveryStatus(message: Message): 'sending' | 'sent' | 'delivered' | 'seen' {
  if (message.id.startsWith('optimistic-')) return 'sending'
  if (message.readAt) return 'seen'
  if (message.deliveredAt) return 'delivered'
  return 'sent'
}

function DeliveryStatusIcon({
  status,
  isMine,
}: {
  status: 'sending' | 'sent' | 'delivered' | 'seen'
  isMine: boolean
}): React.JSX.Element {
  if (!isMine) return <></>

  switch (status) {
    case 'sending':
      return <Loader2 className="h-[13px] w-[13px] text-blue-200 animate-spin" strokeWidth={2.5} />
    case 'sent':
      return <Check className="h-[14px] w-[14px] text-blue-200/70" strokeWidth={2.5} />
    case 'delivered':
      return <CheckCheck className="h-[14px] w-[14px] text-blue-200/70" strokeWidth={2.5} />
    case 'seen':
      return <CheckCheck className="h-[14px] w-[14px] text-blue-200" strokeWidth={2.5} />
  }
}

const STATUS_LABELS: Record<string, string> = {
  sending: 'Đang gửi...',
  sent: 'Đã gửi',
  delivered: 'Đã nhận',
  seen: 'Đã xem',
}

export function MessageBubble({
  message,
  currentUserId,
  isLastFromMe = false,
  showSeenAvatar = false,
  seenByName,
}: MessageBubbleProps): React.JSX.Element {
  // Determine if this message is "mine" — align right like Messenger
  const isMine = currentUserId ? message.senderId === currentUserId : message.senderType === 'AGENT'
  const isSystem = message.senderType === 'SYSTEM'
  const isInternalNote = message.internalNote === true
  const isSending = message.id.startsWith('optimistic-')
  const deliveryStatus = isMine ? getDeliveryStatus(message) : null

  if (isSystem) {
    return (
      <div className="flex justify-center py-4">
        <span className="rounded-full bg-slate-100/80 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500 shadow-sm backdrop-blur-sm border border-slate-200/50">
          {message.content}
        </span>
      </div>
    )
  }

  if (isInternalNote) {
    return (
      <div className="flex w-full justify-start mb-1.5">
        <div className="relative max-w-[85%] rounded-2xl rounded-tl-sm border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm">
          <div className="mb-2">
            <InternalNoteBadge />
          </div>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed italic">
            {message.content}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[10px] font-medium leading-none tracking-tight text-amber-400">
              {timeAgo(message.sentAt)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'flex w-full group mb-0.5',
          isMine ? 'justify-end' : 'justify-start',
          isSending && 'animate-fade-slide-up',
        )}
      >
        <div
          className={cn(
            'relative max-w-[75%] px-4 py-3 transition-all hover:shadow-sm',
            isMine
              ? 'rounded-2xl rounded-tr-sm bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md'
              : 'rounded-2xl rounded-tl-sm bg-white border border-slate-100 text-slate-800 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)]',
            isSending && 'opacity-80',
          )}
        >
          <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
            {message.content}
          </p>
          <div
            className={cn(
              'mt-1.5 flex items-center gap-1.5',
              isMine ? 'justify-end' : 'justify-start',
            )}
          >
            <span
              className={cn(
                'text-[10px] font-medium leading-none tracking-tight',
                isMine ? 'text-blue-200' : 'text-slate-400',
              )}
            >
              {timeAgo(message.sentAt)}
            </span>
            {isMine && deliveryStatus && (
              <DeliveryStatusIcon status={deliveryStatus} isMine={isMine} />
            )}
          </div>
        </div>
      </div>

      {/* Messenger-style status label — only shown below the LAST message from me */}
      {isMine && isLastFromMe && deliveryStatus && !showSeenAvatar && (
        <div className="flex justify-end pr-1 mb-1.5">
          <span
            className={cn(
              'text-[10px] font-medium tracking-tight transition-all duration-300',
              deliveryStatus === 'sending' && 'text-slate-400 animate-pulse',
              deliveryStatus === 'sent' && 'text-slate-400',
              deliveryStatus === 'delivered' && 'text-slate-500',
              deliveryStatus === 'seen' && 'text-blue-500',
            )}
          >
            {STATUS_LABELS[deliveryStatus]}
          </span>
        </div>
      )}

      {/* Messenger-style seen avatar — small avatar of the reader */}
      {showSeenAvatar && seenByName && (
        <div className="flex justify-end pr-1 mb-1 items-center gap-1">
          <div
            className="h-4 w-4 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-sm ring-1 ring-white"
            title={`Đã xem bởi ${seenByName}`}
          >
            <span className="text-[7px] font-bold text-white leading-none">
              {seenByName
                .split(' ')
                .map((n) => n.charAt(0))
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
