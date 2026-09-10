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
      return <Loader2 className="h-[13px] w-[13px] text-white/60 animate-spin" strokeWidth={2.5} />
    case 'sent':
      return <Check className="h-[14px] w-[14px] text-white/50" strokeWidth={2.5} />
    case 'delivered':
      return <CheckCheck className="h-[14px] w-[14px] text-white/50" strokeWidth={2.5} />
    case 'seen':
      return <CheckCheck className="h-[14px] w-[14px] text-white/90" strokeWidth={2.5} />
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
        <span className="rounded-full bg-[#f4f4f6] px-4 py-1.5 text-[11px] font-semibold tracking-wide text-[#8c8c96] border border-[#ececf0]">
          {message.content}
        </span>
      </div>
    )
  }

  if (isInternalNote) {
    return (
      <div className="flex w-full justify-center mb-1.5">
        <div className="relative max-w-[74%] rounded-[12px] border border-[#f0dfae] bg-[#fdf6e7] px-3.5 py-2.5 text-[#5c4a12]">
          <div className="mb-2">
            <InternalNoteBadge />
          </div>
          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed italic">
            {message.content}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 justify-center">
            <span className="text-[11px] text-[#a08a3f]">{timeAgo(message.sentAt)}</span>
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
            'relative max-w-[74%] px-3.5 py-2.5 transition-colors',
            isMine
              ? 'rounded-[12px] rounded-tr-[4px] bg-[#1b1b1f] text-white'
              : 'rounded-[12px] rounded-tl-[4px] bg-white border border-[#ececf0] text-[#1b1b1f]',
            isSending && 'opacity-80',
          )}
        >
          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
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
                'text-[11px] font-medium leading-none tracking-tight',
                isMine ? 'text-white/60' : 'text-[#a0a0aa]',
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
              'text-[10px] font-medium tracking-tight transition-colors',
              deliveryStatus === 'sending' && 'text-[#a0a0aa] animate-pulse',
              deliveryStatus === 'sent' && 'text-[#a0a0aa]',
              deliveryStatus === 'delivered' && 'text-[#8c8c96]',
              deliveryStatus === 'seen' && 'text-[#1b1b1f]',
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
            className="h-4 w-4 rounded-full bg-[#f0f0f3] flex items-center justify-center ring-1 ring-white"
            title={`Đã xem bởi ${seenByName}`}
          >
            <span className="text-[7px] font-bold text-[#4b4b55] leading-none">
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
