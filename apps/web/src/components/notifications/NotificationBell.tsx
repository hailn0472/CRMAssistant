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
          className="h-11 w-11 rounded-full border-slate-200 bg-white text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-indigo-600/40 relative"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
            >
              {displayCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <span className="sr-only" aria-live="polite">
        {unreadCount} unread notifications
      </span>
      <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
        <NotificationPanel />
      </PopoverContent>
    </Popover>
  )
}
