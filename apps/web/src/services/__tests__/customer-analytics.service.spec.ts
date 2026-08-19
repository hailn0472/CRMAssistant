/**
 * Story 6.7 — Unit tests for customer-analytics.service.ts
 *
 * Tests exact GraphQL operations, variables, unwrapping and query key isolation.
 */
jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

import { graphqlRequest } from '@/lib/graphql-client'
import {
  getCustomerAnalytics,
  customerAnalyticsKeys,
  type CustomerAnalyticsResult,
  type CustomerAnalyticsFilterInput,
  type CustomerAnalyticsPaginationInput,
} from '../customer-analytics.service'

const mockGraphqlRequest = graphqlRequest as jest.Mock

const MOCK_ANALYTICS_RESULT: CustomerAnalyticsResult = {
  summary: {
    totalLifetimeValue: 1845600,
    averageLifetimeValue: 12997,
    customerCount: 150,
    calculatedCustomerCount: 142,
    highLtvThreshold: 24500,
    latestCalculatedAt: '2026-08-19T02:00:00.000Z',
    mixedCurrencies: false,
    currencyBreakdown: [{ currency: 'USD', value: 1845600 }],
  },
  ltvDistribution: [
    { label: '$0 - $5,000', min: 0, max: 5000, count: 48 },
    { label: '$5,000 - $15,000', min: 5000, max: 15000, count: 38 },
    { label: '$15,000 - $30,000', min: 15000, max: 30000, count: 26 },
    { label: '$30,000 - $60,000', min: 30000, max: 60000, count: 20 },
    { label: '> $60,000', min: 60000, max: 100000, count: 10 },
  ],
  churnRiskDistribution: [
    { risk: 'LOW', count: 84, percentage: 59.2 },
    { risk: 'MEDIUM', count: 40, percentage: 28.1 },
    { risk: 'HIGH', count: 18, percentage: 12.7 },
    { risk: 'NOT_CALCULATED', count: 8, percentage: 5.3 },
  ],
  customers: {
    items: [
      {
        id: 'contact-1',
        name: 'Nguyen Thi Mai',
        ownerId: 'user-1',
        ownerName: 'Nguyen Van A',
        lifetimeValue: 145000,
        churnRiskScore: 5.2,
        churnRisk: 'LOW',
        lastActivityDate: '2026-08-16T10:00:00.000Z',
        analyticsCalculatedAt: '2026-08-19T02:00:00.000Z',
        recommendedAction: {
          code: 'UPSELL_OPPORTUNITY',
          label: 'Upsell opportunity',
        },
        isHighLifetimeValue: true,
      },
      {
        id: 'contact-2',
        name: 'Global Tech JSC',
        ownerId: 'user-2',
        ownerName: 'Tran Thi B',
        lifetimeValue: 85000,
        churnRiskScore: 82.5,
        churnRisk: 'HIGH',
        lastActivityDate: '2026-06-06T10:00:00.000Z',
        analyticsCalculatedAt: '2026-08-19T02:00:00.000Z',
        recommendedAction: {
          code: 'SCHEDULE_FOLLOW_UP',
          label: 'Schedule follow-up',
        },
        isHighLifetimeValue: true,
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  },
  ltvTrend: [
    {
      snapshotDate: '2026-05-21',
      totalLtv: 1120000,
      averageLtv: 10467,
      customerCount: 107,
    },
    {
      snapshotDate: '2026-08-19',
      totalLtv: 1845600,
      averageLtv: 12997,
      customerCount: 142,
    },
  ],
  cohorts: [
    {
      cohort: '2026-03',
      customerCount: 28,
      totalLtv: 599200,
      averageLtv: 21400,
    },
    {
      cohort: '2026-04',
      customerCount: 32,
      totalLtv: 537600,
      averageLtv: 16800,
    },
  ],
}

describe('customer-analytics.service (Story 6.7 AC 7, 36)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('query key helpers root only at ["customerAnalytics"] and isolate filters/pagination', () => {
    expect(customerAnalyticsKeys.all).toEqual(['customerAnalytics'])

    const filters: CustomerAnalyticsFilterInput = {
      minLifetimeValue: 1000,
      maxLifetimeValue: 5000,
      churnRisks: ['HIGH'],
      lastActivityFrom: '2026-01-01',
      lastActivityTo: '2026-08-01',
      search: 'Nguyen',
      ownerId: 'user-1',
    }
    const pagination: CustomerAnalyticsPaginationInput = { page: 2, pageSize: 50 }

    expect(customerAnalyticsKeys.list(filters, pagination)).toEqual([
      'customerAnalytics',
      { filters, pagination },
    ])

    expect(customerAnalyticsKeys.list()).toEqual([
      'customerAnalytics',
      { filters: null, pagination: null },
    ])
  })

  it('getCustomerAnalytics sends exact query with null filters and pagination when omitted', async () => {
    mockGraphqlRequest.mockResolvedValue({
      customerAnalytics: MOCK_ANALYTICS_RESULT,
    })

    const result = await getCustomerAnalytics()

    expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
    const [query, variables] = mockGraphqlRequest.mock.calls[0]

    expect(query).toContain('query CustomerAnalytics(')
    expect(query).toContain('$filters: CustomerAnalyticsFilterInput')
    expect(query).toContain('$pagination: CustomerAnalyticsPaginationInput')
    expect(query).toContain('customerAnalytics(filters: $filters, pagination: $pagination)')
    expect(query).toContain('totalLifetimeValue')
    expect(query).toContain('currencyBreakdown')
    expect(query).toContain('ltvDistribution')
    expect(query).toContain('churnRiskDistribution')
    expect(query).toContain('recommendedAction')
    expect(query).toContain('ltvTrend')
    expect(query).toContain('cohorts')

    expect(variables).toEqual({
      filters: null,
      pagination: null,
    })

    expect(result).toEqual(MOCK_ANALYTICS_RESULT)
    expect(result.summary.totalLifetimeValue).toBe(1845600)
  })

  it('getCustomerAnalytics passes provided filters and pagination variables', async () => {
    mockGraphqlRequest.mockResolvedValue({
      customerAnalytics: MOCK_ANALYTICS_RESULT,
    })

    const filters: CustomerAnalyticsFilterInput = {
      minLifetimeValue: 5000,
      maxLifetimeValue: 20000,
      churnRisks: ['LOW', 'HIGH'],
      lastActivityFrom: '2026-06-01',
      lastActivityTo: '2026-08-19',
      search: 'Tech',
      ownerId: 'user-2',
    }
    const pagination: CustomerAnalyticsPaginationInput = {
      page: 3,
      pageSize: 10,
    }

    const result = await getCustomerAnalytics(filters, pagination)

    const [, variables] = mockGraphqlRequest.mock.calls[0]
    expect(variables).toEqual({
      filters,
      pagination,
    })

    expect(result.customers.items).toHaveLength(2)
  })

  it('propagates GraphQL and network errors accurately', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('Missing required permission: REPORT:READ'))

    await expect(getCustomerAnalytics()).rejects.toThrow('Missing required permission: REPORT:READ')
  })
})
