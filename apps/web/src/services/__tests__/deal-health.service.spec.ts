import {
  getAtRiskDeals,
  getDealHealth,
  getMyReminderPreferences,
  snoozeDealReminder,
  unsnoozeDealReminder,
  updateReminderPreferences,
} from '../deal-health.service'

const mockFetch = jest.fn()

global.fetch = mockFetch

function mockOkResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ data }),
  })
}

describe('deal-health.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('getDealHealth sends dealId as ID! and returns the health block', async () => {
    mockOkResponse({
      dealHealth: { status: 'AT_RISK', score: 60, signals: ['NO_ACTIVITY_14D'] },
    })

    const result = await getDealHealth('deal-1')

    expect(result).toEqual({
      status: 'AT_RISK',
      score: 60,
      signals: ['NO_ACTIVITY_14D'],
    })
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({ dealId: 'deal-1' })
    expect(callBody.query).toContain('dealHealth(dealId: $dealId)')
    expect(callBody.query).toContain('$dealId: ID!')
  })

  it('getAtRiskDeals passes pagination and returns the connection', async () => {
    mockOkResponse({
      atRiskDeals: {
        total: 1,
        page: 1,
        pageSize: 20,
        items: [
          {
            deal: {
              id: 'deal-1',
              title: 'Renewal',
              value: 24500,
              currency: 'USD',
              expectedCloseDate: null,
              owner: { id: 'user-1', firstName: 'Minh', lastName: 'Nguyen' },
            },
            health: { status: 'STALE', score: 20, signals: ['NO_ACTIVITY_14D'] },
          },
        ],
      },
    })

    const result = await getAtRiskDeals({ page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    expect(result.items[0]!.deal.title).toBe('Renewal')
    expect(result.items[0]!.health.status).toBe('STALE')
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({ pagination: { page: 1, pageSize: 20 } })
  })

  it('getMyReminderPreferences returns the caller row', async () => {
    mockOkResponse({
      myReminderPreferences: {
        emailFrequency: 'WEEKLY',
        notifyNoActivity: true,
        notifyClosingSoon: false,
        notifyAtRisk: true,
      },
    })

    const result = await getMyReminderPreferences()

    expect(result).toEqual({
      emailFrequency: 'WEEKLY',
      notifyNoActivity: true,
      notifyClosingSoon: false,
      notifyAtRisk: true,
    })
  })

  it('snoozeDealReminder sends dealId/days and returns the snooze row', async () => {
    mockOkResponse({
      snoozeDealReminder: {
        id: 'snooze-1',
        dealId: 'deal-1',
        snoozedUntil: '2026-08-08T00:00:00.000Z',
      },
    })

    const result = await snoozeDealReminder('deal-1', 7)

    expect(result).toEqual({
      id: 'snooze-1',
      dealId: 'deal-1',
      snoozedUntil: '2026-08-08T00:00:00.000Z',
    })
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({ dealId: 'deal-1', days: 7 })
    expect(callBody.query).toContain('snoozeDealReminder(dealId: $dealId, days: $days)')
  })

  it('unsnoozeDealReminder returns the boolean', async () => {
    mockOkResponse({ unsnoozeDealReminder: true })

    const result = await unsnoozeDealReminder('deal-1')

    expect(result).toBe(true)
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({ dealId: 'deal-1' })
  })

  it('updateReminderPreferences sends the input and returns the saved row', async () => {
    mockOkResponse({
      updateReminderPreferences: {
        emailFrequency: 'OFF',
        notifyNoActivity: false,
        notifyClosingSoon: false,
        notifyAtRisk: false,
      },
    })

    const result = await updateReminderPreferences({
      emailFrequency: 'OFF',
      notifyNoActivity: false,
      notifyClosingSoon: false,
      notifyAtRisk: false,
    })

    expect(result.emailFrequency).toBe('OFF')
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({
      input: {
        emailFrequency: 'OFF',
        notifyNoActivity: false,
        notifyClosingSoon: false,
        notifyAtRisk: false,
      },
    })
  })
})
