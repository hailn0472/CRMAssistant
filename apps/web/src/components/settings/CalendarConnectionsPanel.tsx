'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, RefreshCw, Unplug } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import {
  CALENDAR_PROVIDERS,
  disconnectCalendar,
  getCalendarAuthUrl,
  getCalendarConnections,
  syncCalendar,
} from '@/services/calendar.service'
import type { CalendarConnection, CalendarProvider } from '@/services/calendar.service'

// Story 4.3 settings panel (AC 40): one row per provider (Google, Outlook),
// each either Connect or connected-with-status. Status badges use the
// Connected / Degraded / Disconnected vocabulary with colour PAIRED with text
// (WCAG 2.1 AA — never colour alone, AC 4).

const PROVIDER_LABELS: Record<CalendarProvider, string> = {
  GOOGLE: 'Google Calendar',
  OUTLOOK: 'Outlook Calendar',
}

function getStatusInfo(connection: CalendarConnection | undefined): {
  label: string
  color: string
} {
  if (!connection || connection.status === 'DISCONNECTED') {
    return { label: 'Not connected', color: '#a0a0aa' }
  }
  if (connection.status === 'REAUTH_REQUIRED' || connection.lastSyncError) {
    return { label: 'Degraded', color: '#c2860a' }
  }
  return { label: 'Connected', color: '#22a06b' }
}

function formatLastSynced(iso: string | null): string {
  if (!iso) return 'Never synced'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Never synced'
  return `Last synced ${date.toLocaleString()}`
}

export function CalendarConnectionsPanel(): React.JSX.Element {
  const queryClient = useQueryClient()

  const {
    data: connections,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['calendarConnections'],
    queryFn: getCalendarConnections,
  })

  const syncMutation = useMutation({
    mutationFn: (provider: CalendarProvider) => syncCalendar(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarConnections'] })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: (provider: CalendarProvider) => disconnectCalendar(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarConnections'] })
    },
  })

  async function handleConnect(provider: CalendarProvider): Promise<void> {
    try {
      const { url } = await getCalendarAuthUrl(provider)
      // Remember which provider started this flow — the callback page needs
      // it to call connectCalendar (the state JWT is opaque to the client).
      sessionStorage.setItem('calendar-connect-provider', provider)
      // Full-page redirect to the provider's consent screen — the state is
      // bound server-side and verified in connectCalendar (AC 14).
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to start calendar connection')
    }
  }

  async function handleSyncNow(provider: CalendarProvider): Promise<void> {
    try {
      await syncMutation.mutateAsync(provider)
      // Success copy states impact, not just "Synced" (UX Feedback Patterns).
      toast.success('Calendar synced — task changes now flow both ways')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Calendar sync failed')
    }
  }

  async function handleDisconnect(connection: CalendarConnection): Promise<void> {
    // The confirm states the real impact (AC 19/40): tasks stop syncing, and
    // events already in the user's calendar are LEFT IN PLACE.
    const confirmed = window.confirm(
      `Disconnect ${PROVIDER_LABELS[connection.provider]}? Tasks will stop syncing to this calendar. Events already in your calendar are left in place.`,
    )
    if (!confirmed) return
    try {
      await disconnectMutation.mutateAsync(connection.provider)
      toast.success(
        `${PROVIDER_LABELS[connection.provider]} disconnected — existing calendar events were kept`,
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect calendar')
    }
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">Calendars</h1>
        <p className="max-w-[60ch] text-[13.5px] text-[#77777f]">
          Connect your Google Calendar or Outlook Calendar so CRM tasks appear there — and edits
          made in either place flow back to the other.
        </p>
      </div>

      {isLoading && <TableSkeleton rows={2} columns={3} />}

      {error && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Unable to load calendar connections.'}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !error && connections && connections.length === 0 && (
        <EmptyState
          icon={<Calendar className="h-6 w-6" />}
          title="No calendars connected"
          description="Connect Google Calendar or Outlook Calendar to sync your tasks."
        />
      )}

      {!isLoading && !error && (
        <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-[#f2f2f5] bg-[#fafafb] text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
                  <th className="py-2.5 pl-[22px] pr-4">Calendar</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4">Last synced</th>
                  <th className="py-2.5 pr-[22px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f7]">
                {CALENDAR_PROVIDERS.map((provider) => {
                  const connection = connections?.find((c) => c.provider === provider)
                  const status = getStatusInfo(connection)
                  const connected = Boolean(connection && connection.status !== 'DISCONNECTED')
                  return (
                    <tr key={provider} className="transition-colors hover:bg-[#fafafb]">
                      <td className="py-3 pl-[22px] pr-4 font-medium text-[#1b1b1f]">
                        {PROVIDER_LABELS[provider]}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                          style={{ color: status.color }}
                        >
                          <span
                            className="block h-1.5 w-1.5 rounded-full"
                            style={{ background: status.color }}
                          />
                          {status.label}
                        </span>
                        {connection?.lastSyncError ? (
                          <p className="mt-1 text-[11.5px] text-[#c2860a]">
                            {connection.lastSyncError}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[12px] text-[#8c8c96]">
                        {formatLastSynced(connection?.lastSyncedAt ?? null)}
                      </td>
                      <td className="py-3 pr-[22px]">
                        {connected && connection ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSyncNow(provider)}
                              disabled={syncMutation.isPending}
                              className="gap-1.5 rounded-[8px] border-[#e6e6eb] text-[#4b4b55] hover:bg-[#f4f4f6]"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Sync now
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDisconnect(connection)}
                              disabled={disconnectMutation.isPending}
                              className="gap-1.5 rounded-[8px] border-red-200 text-red-600 hover:bg-red-50"
                            >
                              <Unplug className="h-3.5 w-3.5" />
                              Disconnect
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleConnect(provider)}
                            className="gap-1.5 rounded-[8px] border-[#e6e6eb] text-[#4b4b55] hover:bg-[#f4f4f6]"
                          >
                            <Calendar className="h-3.5 w-3.5" />
                            Connect
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
