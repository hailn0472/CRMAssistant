'use client'

import { Bell } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNotificationRealtime } from './useNotificationRealtime'
import { NotificationPanel } from './NotificationPanel'
import { getUnreadNotificationCount } from '@/services/notification.service'

/**
 * Story 4.8 (AC 55-62, 69-71): the notification bell that replaces the
 * inert Button at TopbarActions.tsx:14-22. Preserves the existing accessible
 * name, touch target and focus ring byte-for-byte.
 */
export function NotificationBell(): React.JSX.Element {
  useNotificationRealtime()

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadNotificationCount,
    refetchInterval: 60_000,
  })

  const displayCount = unreadCount > 99 ? '99+' : unreadCount

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="View notifications"
          className="relative h-10 w-10 rounded-[10px] border-[#e6e6eb] bg-white text-[#6b6b76] shadow-none transition-colors hover:border-[#d3d2df] hover:bg-[#f7f6ff] hover:text-[#5146c9] focus-visible:ring-2 focus-visible:ring-[#665ce0]/30"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#665ce0] px-1 text-[9.5px] font-bold leading-none text-white shadow-sm"
            >
              {displayCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <span className="sr-only" aria-live="polite">
        {unreadCount} unread notifications
      </span>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[400px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[14px] border-[#e6e6eb] p-0 shadow-[0_18px_50px_rgba(35,31,73,0.16)]"
      >
        <NotificationPanel />
      </PopoverContent>
    </Popover>
  )
}
