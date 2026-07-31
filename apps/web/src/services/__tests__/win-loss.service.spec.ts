import { getWinLossAnalysis } from '../win-loss.service'

const mockFetch = jest.fn()
global.fetch = mockFetch as any

function mockGraphqlResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  })
}

const mockAnalysis = {
  totalClosed: 3,
  wonCount: 2,
  lostCount: 1,
  winRate: 66.7,
  wonValue: 30000,
  lostValue: 5000,
  currency: 'USD',
  winReasons: [{ reason: 'PRICE', count: 1, totalValue: 10000, percentage: 50 }],
  lossReasons: [{ reason: 'BUDGET', count: 1, totalValue: 5000, percentage: 100 }],
  competitors: [
    {
      competitorId: 'c1',
      competitorName: 'Acme Corp',
      wonCount: 1,
      lostCount: 0,
      winRate: 100,
      totalValue: 10000,
    },
  ],
}

describe('win-loss.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('calls GraphQL with the winLossAnalysis query and filter variables', async () => {
    mockGraphqlResponse({ winLossAnalysis: mockAnalysis })
    await getWinLossAnalysis({ startDate: '2026-07-01', endDate: '2026-07-31' })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.query).toContain('query WinLossAnalysis')
    expect(body.query).toContain('winReasons {')
    expect(body.query).toContain('lossReasons {')
    expect(body.query).toContain('competitors {')
    expect(body.variables).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      ownerId: null,
      teamId: null,
    })
  })

  it('passes ownerId and teamId when provided', async () => {
    mockGraphqlResponse({ winLossAnalysis: mockAnalysis })
    await getWinLossAnalysis({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      ownerId: 'user-1',
      teamId: 'team-1',
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.variables).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      ownerId: 'user-1',
      teamId: 'team-1',
    })
  })

  it('returns the typed WinLossAnalysis payload', async () => {
    mockGraphqlResponse({ winLossAnalysis: mockAnalysis })
    const data = await getWinLossAnalysis({ startDate: '2026-07-01', endDate: '2026-07-31' })
    expect(data.totalClosed).toBe(3)
    expect(data.winRate).toBe(66.7)
    expect(data.winReasons[0].reason).toBe('PRICE')
    expect(data.competitors[0].competitorName).toBe('Acme Corp')
  })
})
