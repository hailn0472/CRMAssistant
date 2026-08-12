jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

import { graphqlRequest } from '@/lib/graphql-client'
import {
  fetchDashboards,
  fetchDashboard,
  fetchMyDashboard,
  fetchWidgetData,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  addWidget,
  updateWidget,
  removeWidget,
  reorderWidgets,
  shareDashboard,
  unshareDashboard,
  fetchDashboardShares,
} from '../dashboard.service'

const mockGraphqlRequest = graphqlRequest as jest.Mock

const dashboard = {
  id: 'd-1',
  name: 'My Dashboard',
  isDefault: true,
  isSystemGenerated: false,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  widgets: [],
}

const widget = {
  id: 'w-1',
  type: 'METRIC_CARD' as const,
  title: 'Open Tasks',
  config: { source: 'TASK_STATS', dateRangeDays: 30, stageId: null, ownerId: null, limit: 5 },
  position: 0,
  size: '1x1',
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
}

describe('dashboard.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('fetchDashboards', () => {
    it('calls graphqlRequest with no variables and returns the list', async () => {
      mockGraphqlRequest.mockResolvedValue({ dashboards: { owned: [dashboard], sharedWithMe: [] } })
      const result = await fetchDashboards()

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('dashboards')
      expect(variables).toEqual({})
      expect(result.owned).toHaveLength(1)
      expect(result.sharedWithMe).toHaveLength(0)
    })
  })

  describe('fetchDashboard', () => {
    it('calls graphqlRequest with the dashboard id', async () => {
      mockGraphqlRequest.mockResolvedValue({ dashboard })
      const result = await fetchDashboard('d-1')

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({ id: 'd-1' })
      expect(result.id).toBe('d-1')
    })
  })

  describe('fetchMyDashboard', () => {
    it('calls graphqlRequest with no variables', async () => {
      mockGraphqlRequest.mockResolvedValue({ myDashboard: dashboard })
      const result = await fetchMyDashboard()

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('myDashboard')
      expect(variables).toEqual({})
      expect(result.id).toBe('d-1')
    })
  })

  describe('fetchWidgetData', () => {
    it('calls graphqlRequest with the widget id', async () => {
      const widgetData = {
        widgetId: 'w-1',
        source: 'TASK_STATS',
        type: 'METRIC_CARD',
        generatedAt: '2026-08-12T00:00:00.000Z',
        permissionLimited: false,
        currency: 'USD',
        metric: {
          label: 'Open tasks',
          value: 42,
          unit: null,
          trendPercent: 5,
          trendDirection: 'UP',
        },
        series: [],
        rows: [],
        total: null,
      }
      mockGraphqlRequest.mockResolvedValue({ widgetData })
      const result = await fetchWidgetData('w-1')

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({ widgetId: 'w-1' })
      expect(result.metric?.value).toBe(42)
    })
  })

  describe('createDashboard', () => {
    it('passes the input to the mutation', async () => {
      mockGraphqlRequest.mockResolvedValue({ createDashboard: dashboard })
      await createDashboard({ name: 'New Dashboard', isDefault: false })

      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({ input: { name: 'New Dashboard', isDefault: false } })
    })
  })

  describe('updateDashboard', () => {
    it('passes id and input to the mutation', async () => {
      mockGraphqlRequest.mockResolvedValue({ updateDashboard: dashboard })
      await updateDashboard('d-1', { name: 'Renamed' })

      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({ id: 'd-1', input: { name: 'Renamed' } })
    })
  })

  describe('deleteDashboard', () => {
    it('passes id to the mutation', async () => {
      mockGraphqlRequest.mockResolvedValue({ deleteDashboard: dashboard })
      await deleteDashboard('d-1')

      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({ id: 'd-1' })
    })
  })

  describe('addWidget', () => {
    it('passes dashboardId and input to the mutation', async () => {
      mockGraphqlRequest.mockResolvedValue({ addWidget: widget })
      await addWidget('d-1', { type: 'METRIC_CARD', source: 'TASK_STATS' })

      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({
        dashboardId: 'd-1',
        input: { type: 'METRIC_CARD', source: 'TASK_STATS' },
      })
    })
  })

  describe('updateWidget', () => {
    it('passes id and input to the mutation', async () => {
      mockGraphqlRequest.mockResolvedValue({ updateWidget: widget })
      await updateWidget('w-1', { size: '2x2' })

      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({ id: 'w-1', input: { size: '2x2' } })
    })
  })

  describe('removeWidget', () => {
    it('passes id to the mutation', async () => {
      mockGraphqlRequest.mockResolvedValue({ removeWidget: widget })
      await removeWidget('w-1')

      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({ id: 'w-1' })
    })
  })

  describe('reorderWidgets', () => {
    it('passes dashboardId and ordered ids to the mutation', async () => {
      mockGraphqlRequest.mockResolvedValue({ reorderWidgets: [widget] })
      await reorderWidgets('d-1', ['w-2', 'w-1'])

      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({ dashboardId: 'd-1', orderedWidgetIds: ['w-2', 'w-1'] })
    })
  })

  describe('shareDashboard', () => {
    it('passes dashboardId, target and READ access level', async () => {
      mockGraphqlRequest.mockResolvedValue({ shareDashboard: { id: 's-1', accessLevel: 'READ' } })
      await shareDashboard('d-1', 'u-2', undefined)

      const [, variables] = mockGraphqlRequest.mock.calls[0]
      expect(variables).toEqual({
        dashboardId: 'd-1',
        sharedWithUserId: 'u-2',
        sharedWithTeamId: undefined,
        accessLevel: 'READ',
      })
    })
  })

  describe('unshareDashboard', () => {
    it('passes share id to the mutation and returns the boolean result', async () => {
      mockGraphqlRequest.mockResolvedValue({ unshareDashboard: true })
      const result = await unshareDashboard('s-1')

      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('unshareDashboard')
      expect(variables).toEqual({ shareId: 's-1' })
      expect(result).toBe(true)
    })
  })

  describe('fetchDashboardShares', () => {
    it('passes dashboardId and returns the share list', async () => {
      const shares = [
        {
          id: 's-1',
          resourceId: 'd-1',
          sharedWithUserId: 'u-2',
          sharedWithTeamId: null,
          accessLevel: 'READ',
        },
      ]
      mockGraphqlRequest.mockResolvedValue({ dashboardShares: shares })
      const result = await fetchDashboardShares('d-1')

      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('dashboardShares')
      expect(variables).toEqual({ dashboardId: 'd-1' })
      expect(result).toEqual(shares)
    })
  })
})
