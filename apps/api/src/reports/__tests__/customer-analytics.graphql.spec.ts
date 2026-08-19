/**
 * Story 6.7 (Contract D26–D34, F48, R-010): customerAnalytics schema surface.
 * Asserts the query/enums/inputs/result fields exist after
 * registerCustomerAnalyticsGraphql + builder.toSchema() (module/barrel
 * registration lockstep), that the typed permission gates fire, and that
 * unknown input keys are rejected — the closed-input contract.
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { graphql, printSchema } from 'graphql'

// Must import BEFORE schema (Pothos registration order — R-010).
import '../customer-analytics.graphql'
import { schema } from '../../graphql/schema'
import { registerCustomerAnalyticsGraphql } from '../customer-analytics.graphql'
import { requirePermission } from '../../common/guards/permission-check'
import { CUSTOMER_CHURN_RISKS } from '../customer-analytics-score'
import type { CustomerAnalyticsService } from '../customer-analytics.service'

jest.mock('../../common/guards/permission-check', () => ({
  requirePermission: jest.fn(),
}))

const mockRequirePermission = requirePermission as jest.Mock

const mockResult = {
  summary: {
    totalLifetimeValue: 350.5,
    averageLifetimeValue: 350.5,
    customerCount: 1,
    calculatedCustomerCount: 1,
    highLtvThreshold: 350.5,
    latestCalculatedAt: '2026-08-15T02:00:00.000Z',
    mixedCurrencies: false,
    currencyBreakdown: [{ currency: 'USD', value: 350.5 }],
  },
  ltvDistribution: [{ label: '0-80', min: 0, max: 80, count: 1 }],
  churnRiskDistribution: [{ risk: 'HIGH', count: 1, percentage: 100 }],
  customers: {
    items: [
      {
        id: 'contact-1',
        name: 'Ada Lovelace',
        ownerId: 'user-owner',
        ownerName: 'Test Owner',
        lifetimeValue: 350.5,
        churnRiskScore: 85,
        churnRisk: 'HIGH',
        lastActivityDate: '2026-08-01T00:00:00.000Z',
        analyticsCalculatedAt: '2026-08-15T02:00:00.000Z',
        recommendedAction: { code: 'SCHEDULE_FOLLOW_UP', label: 'Schedule follow-up' },
        isHighLifetimeValue: false,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  },
  ltvTrend: [
    {
      snapshotDate: '2026-08-15T00:00:00.000Z',
      totalLtv: 350.5,
      averageLtv: 350.5,
      customerCount: 1,
    },
  ],
  cohorts: [{ cohort: '2026-01', customerCount: 1, totalLtv: 350.5, averageLtv: 350.5 }],
}

function registerMockService(): jest.Mocked<CustomerAnalyticsService> {
  const service = {
    customerAnalytics: jest.fn().mockResolvedValue(mockResult),
  } as unknown as jest.Mocked<CustomerAnalyticsService>
  registerCustomerAnalyticsGraphql(service)
  return service
}

const CONTEXT = {
  user: {
    sub: 'user-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    roles: ['SALES_MANAGER'],
    email: 'manager@test.local',
  },
}

describe('customerAnalytics GraphQL schema (Story 6.7)', () => {
  beforeEach(() => {
    mockRequirePermission.mockReset()
    mockRequirePermission.mockResolvedValue(undefined)
  })

  it('registers the query, enums, inputs and full result shape in the SDL (D26, G1–G3)', () => {
    const sdl = printSchema(schema)

    expect(sdl).toContain(
      'customerAnalytics(filters: CustomerAnalyticsFilterInput, pagination: CustomerAnalyticsPaginationInput): CustomerAnalytics',
    )
    expect(sdl).toContain('enum CustomerChurnRisk')
    expect(sdl).toContain('LOW')
    expect(sdl).toContain('MEDIUM')
    expect(sdl).toContain('HIGH')
    expect(sdl).toContain('enum CustomerRecommendedActionCode')
    expect(sdl).toContain('SCHEDULE_FOLLOW_UP')
    expect(sdl).toContain('UPSELL_OPPORTUNITY')
    expect(sdl).toContain('MONITOR')

    expect(sdl).toContain('input CustomerAnalyticsFilterInput')
    for (const field of [
      'minLifetimeValue: Float',
      'maxLifetimeValue: Float',
      'churnRisks: [CustomerChurnRisk!]',
      'lastActivityFrom: String',
      'lastActivityTo: String',
      'search: String',
      'ownerId: String',
    ]) {
      expect(sdl).toContain(field)
    }
    expect(sdl).toContain('input CustomerAnalyticsPaginationInput')
    expect(sdl).toContain('page: Int')
    expect(sdl).toContain('pageSize: Int')

    expect(sdl).toContain('type CustomerAnalyticsSummary')
    for (const field of [
      'totalLifetimeValue: Float',
      'averageLifetimeValue: Float',
      'customerCount: Int',
      'calculatedCustomerCount: Int',
      'highLtvThreshold: Float',
      'latestCalculatedAt: String',
      'mixedCurrencies: Boolean',
      'currencyBreakdown: [CurrencyBreakdownEntry!]',
    ]) {
      expect(sdl).toContain(field)
    }
    expect(sdl).toContain('ltvDistribution: [LtvDistributionBin!]')
    expect(sdl).toContain('churnRiskDistribution: [ChurnRiskDistributionBin!]')
    expect(sdl).toContain('customers: CustomerAnalyticsCustomerConnection')
    expect(sdl).toContain('ltvTrend: [CustomerAnalyticsTrendPoint!]')
    expect(sdl).toContain('cohorts: [CustomerAnalyticsCohort!]')
    expect(sdl).toContain('churnRisk: CustomerChurnRisk')
    expect(sdl).toContain('recommendedAction: CustomerRecommendedAction')
    expect(sdl).toContain('isHighLifetimeValue: Boolean')
    expect(sdl).toContain('snapshotDate: String')
    expect(sdl).toContain('cohort: String')
  })

  it('executes the query and returns the typed result (G3)', async () => {
    const service = registerMockService()
    const response = await graphql({
      schema,
      source: `query CustomerAnalytics($filters: CustomerAnalyticsFilterInput, $pagination: CustomerAnalyticsPaginationInput) {
        customerAnalytics(filters: $filters, pagination: $pagination) {
          summary { totalLifetimeValue customerCount mixedCurrencies currencyBreakdown { currency value } }
          ltvDistribution { label min max count }
          churnRiskDistribution { risk count percentage }
          customers { total items { id name churnRisk recommendedAction { code label } isHighLifetimeValue } }
          ltvTrend { snapshotDate totalLtv customerCount }
          cohorts { cohort customerCount totalLtv }
        }
      }`,
      variableValues: { filters: { churnRisks: ['HIGH'] }, pagination: { page: 1, pageSize: 20 } },
      contextValue: CONTEXT,
    })

    expect(response.errors).toBeUndefined()
    // The response mirrors exactly the fields the query selected.
    expect(response.data?.customerAnalytics).toEqual({
      summary: {
        totalLifetimeValue: 350.5,
        customerCount: 1,
        mixedCurrencies: false,
        currencyBreakdown: [{ currency: 'USD', value: 350.5 }],
      },
      ltvDistribution: mockResult.ltvDistribution,
      churnRiskDistribution: mockResult.churnRiskDistribution,
      customers: {
        total: 1,
        items: [
          {
            id: 'contact-1',
            name: 'Ada Lovelace',
            churnRisk: 'HIGH',
            recommendedAction: { code: 'SCHEDULE_FOLLOW_UP', label: 'Schedule follow-up' },
            isHighLifetimeValue: false,
          },
        ],
      },
      ltvTrend: [{ snapshotDate: '2026-08-15T00:00:00.000Z', totalLtv: 350.5, customerCount: 1 }],
      cohorts: [{ cohort: '2026-01', customerCount: 1, totalLtv: 350.5 }],
    })
    expect(service.customerAnalytics).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      { churnRisks: ['HIGH'] },
      { page: 1, pageSize: 20 },
    )
    // REPORT + CONTACT + DEAL read gates all fired (D28).
    expect(mockRequirePermission).toHaveBeenCalledWith(CONTEXT, 'REPORT', 'READ')
    expect(mockRequirePermission).toHaveBeenCalledWith(CONTEXT, 'CONTACT', 'READ')
    expect(mockRequirePermission).toHaveBeenCalledWith(CONTEXT, 'DEAL', 'READ')
  })

  it('defaults filters/pagination to empty objects when omitted', async () => {
    const service = registerMockService()
    const response = await graphql({
      schema,
      source: `query { customerAnalytics { summary { customerCount } } }`,
      contextValue: CONTEXT,
    })

    expect(response.errors).toBeUndefined()
    expect(service.customerAnalytics).toHaveBeenCalledWith('tenant-1', 'user-1', {}, {})
  })

  it('rejects unknown input keys — the input is closed (D27, S5, G5)', async () => {
    registerMockService()
    const response = await graphql({
      schema,
      source: `query {
        customerAnalytics(filters: { where: "raw-json", sort: "churnRiskScore" }) {
          summary { customerCount }
        }
      }`,
      contextValue: CONTEXT,
    })

    expect(response.errors).toBeDefined()
    expect(response.errors![0]!.message).toMatch(/where|sort|not defined|unknown/i)
  })

  it('rejects an unauthenticated context (D28)', async () => {
    registerMockService()
    const response = await graphql({
      schema,
      source: `query { customerAnalytics { summary { customerCount } } }`,
      contextValue: {},
    })

    expect(response.errors).toBeDefined()
    expect(response.errors![0]!.originalError).toBeInstanceOf(UnauthorizedException)
  })

  it('propagates permission denial from the typed gates (D28, S2)', async () => {
    registerMockService()
    mockRequirePermission.mockRejectedValueOnce(
      new ForbiddenException('Missing required permission: CONTACT:READ'),
    )
    const response = await graphql({
      schema,
      source: `query { customerAnalytics { summary { customerCount } } }`,
      contextValue: CONTEXT,
    })

    expect(response.errors).toBeDefined()
    expect(response.errors![0]!.message).toMatch(/CONTACT:READ/)
  })

  it('keeps the enum vocabulary in sync with the pure const tuple (G2)', () => {
    const sdl = printSchema(schema)
    for (const risk of CUSTOMER_CHURN_RISKS) {
      expect(sdl).toContain(risk)
    }
  })
})
