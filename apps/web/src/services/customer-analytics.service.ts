/**
 * Story 6.7 — Frontend Customer Analytics Service.
 *
 * Hand-written GraphQL service over graphqlRequest (no Apollo, no codegen).
 * Query keys rooted strictly at ['customerAnalytics'] to guarantee isolation
 * from sales and custom report caches.
 */
import { graphqlRequest } from '@/lib/graphql-client'

// ─── Types (mirror of backend schema in customer-analytics.graphql.ts) ──

export type CustomerChurnRisk = 'LOW' | 'MEDIUM' | 'HIGH'

export type CustomerRecommendedActionCode = 'SCHEDULE_FOLLOW_UP' | 'UPSELL_OPPORTUNITY' | 'MONITOR'

export interface CurrencyBreakdownEntry {
  currency: string
  value: number
}

export interface CustomerAnalyticsSummary {
  totalLifetimeValue: number | null
  averageLifetimeValue: number | null
  customerCount: number
  calculatedCustomerCount: number
  highLtvThreshold: number | null
  latestCalculatedAt: string | null
  mixedCurrencies: boolean
  currencyBreakdown: CurrencyBreakdownEntry[]
}

export interface LtvDistributionBin {
  label: string
  min: number
  max: number
  count: number
}

export interface ChurnRiskDistributionBin {
  risk: string // 'LOW' | 'MEDIUM' | 'HIGH' | 'NOT_CALCULATED'
  count: number
  percentage: number
}

export interface CustomerRecommendedAction {
  code: CustomerRecommendedActionCode
  label: string
}

export interface CustomerAnalyticsCustomerItem {
  id: string
  name: string
  ownerId: string
  ownerName: string | null
  lifetimeValue: number | null
  churnRiskScore: number | null
  churnRisk: CustomerChurnRisk | null
  lastActivityDate: string | null
  analyticsCalculatedAt: string | null
  recommendedAction: CustomerRecommendedAction
  isHighLifetimeValue: boolean
}

export interface CustomerAnalyticsCustomerConnection {
  items: CustomerAnalyticsCustomerItem[]
  total: number
  page: number
  pageSize: number
}

export interface CustomerAnalyticsTrendPoint {
  snapshotDate: string
  totalLtv: number
  averageLtv: number
  customerCount: number
}

export interface CustomerAnalyticsCohort {
  cohort: string
  customerCount: number
  totalLtv: number
  averageLtv: number
}

export interface CustomerAnalyticsResult {
  summary: CustomerAnalyticsSummary
  ltvDistribution: LtvDistributionBin[]
  churnRiskDistribution: ChurnRiskDistributionBin[]
  customers: CustomerAnalyticsCustomerConnection
  ltvTrend: CustomerAnalyticsTrendPoint[]
  cohorts: CustomerAnalyticsCohort[]
}

export interface CustomerAnalyticsFilterInput {
  minLifetimeValue?: number | null
  maxLifetimeValue?: number | null
  churnRisks?: CustomerChurnRisk[] | null
  lastActivityFrom?: string | null
  lastActivityTo?: string | null
  search?: string | null
  ownerId?: string | null
}

export interface CustomerAnalyticsPaginationInput {
  page?: number | null
  pageSize?: number | null
}

// ─── Query Keys ──────────────────────────────────────────────────────────

export const customerAnalyticsKeys = {
  all: ['customerAnalytics'] as const,
  list: (
    filters?: CustomerAnalyticsFilterInput | null,
    pagination?: CustomerAnalyticsPaginationInput | null,
  ) => ['customerAnalytics', { filters: filters ?? null, pagination: pagination ?? null }] as const,
}

// ─── Fragments ───────────────────────────────────────────────────────────

const CUSTOMER_ANALYTICS_QUERY = `
  query CustomerAnalytics(
    $filters: CustomerAnalyticsFilterInput
    $pagination: CustomerAnalyticsPaginationInput
  ) {
    customerAnalytics(filters: $filters, pagination: $pagination) {
      summary {
        totalLifetimeValue
        averageLifetimeValue
        customerCount
        calculatedCustomerCount
        highLtvThreshold
        latestCalculatedAt
        mixedCurrencies
        currencyBreakdown {
          currency
          value
        }
      }
      ltvDistribution {
        label
        min
        max
        count
      }
      churnRiskDistribution {
        risk
        count
        percentage
      }
      customers {
        items {
          id
          name
          ownerId
          ownerName
          lifetimeValue
          churnRiskScore
          churnRisk
          lastActivityDate
          analyticsCalculatedAt
          recommendedAction {
            code
            label
          }
          isHighLifetimeValue
        }
        total
        page
        pageSize
      }
      ltvTrend {
        snapshotDate
        totalLtv
        averageLtv
        customerCount
      }
      cohorts {
        cohort
        customerCount
        totalLtv
        averageLtv
      }
    }
  }
`

// ─── Operations ──────────────────────────────────────────────────────────

export async function getCustomerAnalytics(
  filters?: CustomerAnalyticsFilterInput,
  pagination?: CustomerAnalyticsPaginationInput,
): Promise<CustomerAnalyticsResult> {
  const data = await graphqlRequest<{ customerAnalytics: CustomerAnalyticsResult }>(
    CUSTOMER_ANALYTICS_QUERY,
    {
      filters: filters ?? null,
      pagination: pagination ?? null,
    },
  )
  return data.customerAnalytics
}
