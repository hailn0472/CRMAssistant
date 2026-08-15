jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

import { graphqlRequest } from '@/lib/graphql-client'
import { getSalesForecast, getForecastAccuracy } from '../forecast.service'

const mockGraphqlRequest = graphqlRequest as jest.Mock

describe('forecast.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getSalesForecast', () => {
    const filter = { startDate: '2026-07-01', endDate: '2026-11-30', groupBy: 'MONTH' as const }
    const mockResponse = {
      salesForecast: {
        buckets: [
          {
            key: '2026-07',
            label: 'Jul 2026',
            periodStart: '2026-07-01',
            periodEnd: '2026-07-31',
            weightedValue: 0,
            totalValue: 0,
            count: 0,
          },
          {
            key: '2026-08',
            label: 'Aug 2026',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-31',
            weightedValue: 15000,
            totalValue: 30000,
            count: 1,
          },
        ],
        commit: { weightedValue: 37500, totalValue: 50000, count: 1 },
        bestCase: { weightedValue: 52500, totalValue: 80000, count: 2 },
        pipeline: { weightedValue: 52500, totalValue: 80000, count: 2 },
        currency: 'USD',
      },
    }

    it('calls graphqlRequest with correct query and variables', async () => {
      mockGraphqlRequest.mockResolvedValue(mockResponse)
      await getSalesForecast(filter)

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('salesForecast')
      expect(variables).toEqual({ input: filter })
    })

    it('returns sales forecast data', async () => {
      mockGraphqlRequest.mockResolvedValue(mockResponse)
      const result = await getSalesForecast(filter)

      expect(result).toEqual(mockResponse.salesForecast)
      expect(result.currency).toBe('USD')
      expect(result.buckets).toHaveLength(2)
    })

    it('throws when graphqlRequest fails', async () => {
      mockGraphqlRequest.mockRejectedValue(new Error('Network error'))
      await expect(getSalesForecast(filter)).rejects.toThrow('Network error')
    })
  })

  describe('getForecastAccuracy', () => {
    const startDate = '2026-06-01'
    const endDate = '2026-06-30'

    it('calls graphqlRequest with correct args', async () => {
      mockGraphqlRequest.mockResolvedValue({ forecastAccuracy: [] })
      await getForecastAccuracy(startDate, endDate)

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('forecastAccuracy')
      expect(variables).toEqual({ startDate, endDate })
    })

    it('returns accuracy periods', async () => {
      const mockData = {
        forecastAccuracy: [
          {
            periodStart: '2026-06-01',
            periodEnd: '2026-06-30',
            forecastValue: 50000,
            actualValue: 45000,
            variance: -5000,
            accuracyPct: 90,
          },
        ],
      }
      mockGraphqlRequest.mockResolvedValue(mockData)
      const result = await getForecastAccuracy(startDate, endDate)

      expect(result).toHaveLength(1)
      expect(result[0].accuracyPct).toBe(90)
    })
  })
})
