import { BadRequestException, ForbiddenException } from '@nestjs/common'

import { WidgetDataService } from '../widget-data.service'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'

function makeWidget(
  source = 'TASK_STATS',
  type = 'METRIC_CARD',
  limit = 5,
): { id: string; type: string; config: Record<string, unknown> } {
  return { id: 'widget-1', type, config: { source, limit } }
}

function buildFixture(): any {
  const prisma: any = {
    widget: { findFirst: jest.fn().mockResolvedValue(makeWidget()) },
    contact: {
      count: jest.fn().mockResolvedValue(7),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    task: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    activity: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const cache: any = {
    getOrSetTenantJson: jest.fn((_namespace, _tenant, _scope, _ttl, loader) => loader()),
  }
  const requirePermission = jest.fn().mockResolvedValue(undefined)
  const service = new WidgetDataService(prisma, cache)
  return { service, prisma, cache, requirePermission }
}

describe('WidgetDataService', () => {
  it('rejects a missing widget before reading data or cache', async () => {
    const { service, prisma, cache, requirePermission } = buildFixture()
    prisma.widget.findFirst.mockResolvedValue(null)

    await expect(
      service.widgetData(TENANT_ID, USER_ID, 'missing-widget', { requirePermission }),
    ).rejects.toThrow(BadRequestException)
    expect(requirePermission).toHaveBeenCalledWith('REPORT', 'READ')
    expect(cache.getOrSetTenantJson).not.toHaveBeenCalled()
  })

  it('returns an empty result when the source permission is forbidden', async () => {
    const { service, prisma, cache, requirePermission } = buildFixture()
    prisma.widget.findFirst.mockResolvedValue(makeWidget('CONTACT_COUNT'))
    requirePermission.mockImplementation(async (resource: string) => {
      if (resource !== 'REPORT') throw new ForbiddenException()
    })

    const result = await service.widgetData(TENANT_ID, USER_ID, 'widget-1', {
      requirePermission,
    })

    expect(result).toMatchObject({
      widgetId: 'widget-1',
      source: 'CONTACT_COUNT',
      permissionLimited: true,
      metric: null,
      series: [],
      rows: [],
      total: null,
    })
    expect(cache.getOrSetTenantJson).not.toHaveBeenCalled()
  })

  it('propagates non-forbidden source permission failures', async () => {
    const { service, requirePermission } = buildFixture()
    const error = new Error('permission service unavailable')
    requirePermission.mockImplementation(async (resource: string) => {
      if (resource !== 'REPORT') throw error
    })

    await expect(
      service.widgetData(TENANT_ID, USER_ID, 'widget-1', { requirePermission }),
    ).rejects.toBe(error)
  })

  it('resolves CONTACT_COUNT as a tenant-scoped metric', async () => {
    const { service, prisma, cache, requirePermission } = buildFixture()
    prisma.widget.findFirst.mockResolvedValue(makeWidget('CONTACT_COUNT'))
    prisma.contact.count.mockResolvedValue(12)

    const result = await service.widgetData(TENANT_ID, USER_ID, 'widget-1', {
      requirePermission,
    })

    expect(prisma.contact.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, deletedAt: null },
    })
    expect(cache.getOrSetTenantJson).toHaveBeenCalledWith(
      'dashboard-widget',
      TENANT_ID,
      `${USER_ID}:widget-1:CONTACT_COUNT:5`,
      30,
      expect.any(Function),
    )
    expect(result.metric).toMatchObject({ label: 'Contacts', value: 12 })
    expect(result.total).toBe(12)
  })

  it('maps LEAD_FUNNEL groups into chart points and totals', async () => {
    const { service, prisma, requirePermission } = buildFixture()
    prisma.widget.findFirst.mockResolvedValue(makeWidget('LEAD_FUNNEL', 'BAR_CHART'))
    prisma.contact.groupBy.mockResolvedValue([
      { leadStatus: 'NEW_LEAD', _count: { _all: 4 } },
      { leadStatus: 'QUALIFIED', _count: { _all: 3 } },
    ])

    const result = await service.widgetData(TENANT_ID, USER_ID, 'widget-1', {
      requirePermission,
    })

    expect(prisma.contact.groupBy).toHaveBeenCalledWith({
      by: ['leadStatus'],
      where: { tenantId: TENANT_ID, deletedAt: null },
      _count: { _all: true },
    })
    expect(result.series[0]).toMatchObject({ key: 'lead-funnel', label: 'Lead funnel' })
    expect(result.series[0]?.points).toEqual([
      { key: 'NEW_LEAD', label: 'NEW LEAD', value: 4, secondaryValue: null },
      { key: 'QUALIFIED', label: 'QUALIFIED', value: 3, secondaryValue: null },
    ])
    expect(result.total).toBe(7)
  })

  it('renders MY_TASKS with due dates and urgent/non-urgent badges', async () => {
    const { service, prisma, requirePermission } = buildFixture()
    const dueDate = new Date('2026-09-10T09:00:00.000Z')
    prisma.widget.findFirst.mockResolvedValue(makeWidget('MY_TASKS', 'TASK_LIST', 2))
    prisma.task.findMany.mockResolvedValue([
      { id: 'task-urgent', title: 'Call lead', dueDate, priority: 'URGENT' },
      { id: 'task-normal', title: 'Send email', dueDate: null, priority: 'NORMAL' },
    ])

    const result = await service.widgetData(TENANT_ID, USER_ID, 'widget-1', {
      requirePermission,
    })

    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        assignedTo: USER_ID,
        deletedAt: null,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 2,
      select: { id: true, title: true, dueDate: true, priority: true },
    })
    expect(result.rows).toEqual([
      {
        id: 'task-urgent',
        primaryLabel: 'Call lead',
        secondaryLabel: dueDate.toISOString(),
        value: 'URGENT',
        href: '/tasks/task-urgent',
        badgeLabel: 'URGENT',
        badgeTone: 'DANGER',
      },
      {
        id: 'task-normal',
        primaryLabel: 'Send email',
        secondaryLabel: null,
        value: 'NORMAL',
        href: '/tasks/task-normal',
        badgeLabel: 'NORMAL',
        badgeTone: 'NEUTRAL',
      },
    ])
    expect(result.total).toBe(2)
  })

  it('resolves TASK_STATS from open and completed task counts', async () => {
    const { service, prisma, requirePermission } = buildFixture()
    prisma.widget.findFirst.mockResolvedValue(makeWidget('TASK_STATS'))
    prisma.task.count.mockResolvedValueOnce(5).mockResolvedValueOnce(8)

    const result = await service.widgetData(TENANT_ID, USER_ID, 'widget-1', {
      requirePermission,
    })

    expect(prisma.task.count).toHaveBeenCalledTimes(2)
    expect(result.metric).toMatchObject({ label: 'Open tasks', value: 5 })
    expect(result.series[0]?.points).toEqual([
      { key: 'open', label: 'Open', value: 5, secondaryValue: null },
      { key: 'completed', label: 'Completed', value: 8, secondaryValue: null },
    ])
    expect(result.total).toBe(13)
  })

  it('loads RECENT_ACTIVITY through the cache loader on a miss', async () => {
    const { service, prisma, cache, requirePermission } = buildFixture()
    prisma.widget.findFirst.mockResolvedValue(makeWidget('RECENT_ACTIVITY', 'ACTIVITY_FEED', 1))
    const createdAt = new Date('2026-09-09T12:00:00.000Z')
    prisma.activity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        title: 'Lead qualified',
        createdAt,
        contactId: 'contact-1',
        type: 'NOTE',
      },
    ])

    const result = await service.widgetData(TENANT_ID, USER_ID, 'widget-1', {
      requirePermission,
    })

    expect(cache.getOrSetTenantJson).toHaveBeenCalled()
    expect(prisma.activity.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { id: true, title: true, createdAt: true, contactId: true, type: true },
    })
    expect(result.rows[0]).toMatchObject({
      id: 'activity-1',
      primaryLabel: 'Lead qualified',
      secondaryLabel: createdAt.toISOString(),
      value: 'NOTE',
      href: '/contacts/contact-1',
    })
  })

  it('returns cached RECENT_ACTIVITY without querying the database', async () => {
    const { service, prisma, cache, requirePermission } = buildFixture()
    prisma.widget.findFirst.mockResolvedValue(makeWidget('RECENT_ACTIVITY', 'ACTIVITY_FEED'))
    const cached = {
      metric: null,
      series: [],
      rows: [
        {
          id: 'activity-cached',
          primaryLabel: 'Cached activity',
          secondaryLabel: null,
          value: 'CALL',
          href: '/contacts/contact-2',
          badgeLabel: null,
          badgeTone: null,
        },
      ],
      total: 1,
    }
    cache.getOrSetTenantJson.mockResolvedValue(cached)

    const result = await service.widgetData(TENANT_ID, USER_ID, 'widget-1', {
      requirePermission,
    })

    expect(result.rows).toEqual(cached.rows)
    expect(result.total).toBe(1)
    expect(prisma.activity.findMany).not.toHaveBeenCalled()
  })
})
