import { CalendarSyncService } from '../calendar-sync.service'
import type { CalendarProviderRegistry } from '../calendar-providers.token'
import type { BackgroundMetricsPort } from '../../observability/metrics.types'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { ActivityService } from '../../activities/activities.service'
import type { ActivityLogPreferenceService } from '../../activities/activity-log-preference.service'
import type { CalendarOAuthService } from '../calendar-oauth.service'

function makeMetrics(): BackgroundMetricsPort & {
  recordJob: jest.Mock
  observeJobDuration: jest.Mock
} {
  return { recordJob: jest.fn(), observeJobDuration: jest.fn() }
}

function makeService(
  prisma: { calendarConnection: { findMany: jest.Mock } },
  metrics?: BackgroundMetricsPort,
): CalendarSyncService {
  return new CalendarSyncService(
    prisma as unknown as PrismaService,
    {} as AuditService,
    {} as ActivityService,
    {} as ActivityLogPreferenceService,
    {} as CalendarOAuthService,
    {} as CalendarProviderRegistry,
    metrics,
  )
}

describe('CalendarSyncService background metrics', () => {
  it('records success for an empty startup sweep', async () => {
    const metrics = makeMetrics()
    const prisma = { calendarConnection: { findMany: jest.fn().mockResolvedValue([]) } }
    const service = makeService(prisma, metrics)

    await expect(service.syncAllConnections()).resolves.toBeUndefined()

    expect(metrics.recordJob).toHaveBeenCalledWith({ jobGroup: 'calendar', outcome: 'success' })
    expect(metrics.observeJobDuration).toHaveBeenCalledWith(
      { jobGroup: 'calendar', outcome: 'success' },
      expect.any(Number),
    )
  })

  it('records isolated connection errors without an ID label', async () => {
    const metrics = makeMetrics()
    const prisma = {
      calendarConnection: {
        findMany: jest.fn().mockResolvedValue([{ id: 'connection-private-id' }]),
      },
    }
    const service = makeService(prisma, metrics)
    jest.spyOn(service, 'syncConnection').mockRejectedValue(new Error('provider unavailable'))

    await expect(service.syncAllConnections()).resolves.toBeUndefined()

    expect(metrics.recordJob).toHaveBeenCalledWith({ jobGroup: 'calendar', outcome: 'error' })
    expect(metrics.observeJobDuration).toHaveBeenCalledWith(
      { jobGroup: 'calendar', outcome: 'error' },
      expect.any(Number),
    )
    expect(metrics.recordJob).toHaveBeenCalledTimes(1)
    expect(metrics.recordJob.mock.calls.flat()).not.toContain('connection-private-id')
  })

  it('keeps the sweep successful when metrics throw', async () => {
    const metrics: BackgroundMetricsPort = {
      recordJob: jest.fn(() => {
        throw new Error('metrics unavailable')
      }),
      observeJobDuration: jest.fn(() => {
        throw new Error('metrics unavailable')
      }),
    }
    const prisma = { calendarConnection: { findMany: jest.fn().mockResolvedValue([]) } }
    const service = makeService(prisma, metrics)

    await expect(service.syncAllConnections()).resolves.toBeUndefined()
  })
})
