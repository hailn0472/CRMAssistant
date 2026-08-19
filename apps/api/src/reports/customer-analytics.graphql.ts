import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { CUSTOMER_CHURN_RISKS, type RecommendedAction } from './customer-analytics-score'
import type {
  CustomerAnalyticsService,
  CustomerAnalyticsResult,
  CustomerAnalyticsSummary,
  CustomerAnalyticsFilterInput,
  CustomerAnalyticsPaginationInput,
  CustomerAnalyticsCustomerItem,
  CustomerAnalyticsCustomerConnection,
  CustomerAnalyticsTrendPoint,
  CustomerAnalyticsCohort,
  CurrencyBreakdownEntry,
  LtvDistributionBin,
  ChurnRiskDistributionBin,
} from './customer-analytics.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── Enum Types ──────────────────────────────────────────

const CustomerChurnRiskRef = builder.enumType('CustomerChurnRisk', {
  values: CUSTOMER_CHURN_RISKS,
})

const CustomerRecommendedActionCodeRef = builder.enumType('CustomerRecommendedActionCode', {
  values: ['SCHEDULE_FOLLOW_UP', 'UPSELL_OPPORTUNITY', 'MONITOR'] as const,
})

// ─── Object Types ─────────────────────────────────────────

const CurrencyBreakdownEntryRef =
  builder.objectRef<CurrencyBreakdownEntry>('CurrencyBreakdownEntry')

CurrencyBreakdownEntryRef.implement({
  fields: (t) => ({
    currency: t.exposeString('currency'),
    value: t.exposeFloat('value'),
  }),
})

const CustomerAnalyticsSummaryRef = builder.objectRef<CustomerAnalyticsSummary>(
  'CustomerAnalyticsSummary',
)

CustomerAnalyticsSummaryRef.implement({
  fields: (t) => ({
    totalLifetimeValue: t.exposeFloat('totalLifetimeValue', { nullable: true }),
    averageLifetimeValue: t.exposeFloat('averageLifetimeValue', { nullable: true }),
    customerCount: t.exposeInt('customerCount'),
    calculatedCustomerCount: t.exposeInt('calculatedCustomerCount'),
    highLtvThreshold: t.exposeFloat('highLtvThreshold', { nullable: true }),
    latestCalculatedAt: t.exposeString('latestCalculatedAt', { nullable: true }),
    mixedCurrencies: t.exposeBoolean('mixedCurrencies'),
    currencyBreakdown: t.field({
      type: [CurrencyBreakdownEntryRef],
      resolve: (summary) => summary.currencyBreakdown,
    }),
  }),
})

const LtvDistributionBinRef = builder.objectRef<LtvDistributionBin>('LtvDistributionBin')

LtvDistributionBinRef.implement({
  fields: (t) => ({
    label: t.exposeString('label'),
    min: t.exposeFloat('min'),
    max: t.exposeFloat('max'),
    count: t.exposeInt('count'),
  }),
})

const ChurnRiskDistributionBinRef = builder.objectRef<ChurnRiskDistributionBin>(
  'ChurnRiskDistributionBin',
)

ChurnRiskDistributionBinRef.implement({
  fields: (t) => ({
    // 'LOW' | 'MEDIUM' | 'HIGH' | 'NOT_CALCULATED'
    risk: t.exposeString('risk'),
    count: t.exposeInt('count'),
    percentage: t.exposeFloat('percentage'),
  }),
})

const CustomerRecommendedActionRef = builder.objectRef<RecommendedAction>(
  'CustomerRecommendedAction',
)

CustomerRecommendedActionRef.implement({
  fields: (t) => ({
    code: t.field({ type: CustomerRecommendedActionCodeRef, resolve: (action) => action.code }),
    label: t.exposeString('label'),
  }),
})

const CustomerAnalyticsCustomerRef = builder.objectRef<CustomerAnalyticsCustomerItem>(
  'CustomerAnalyticsCustomer',
)

CustomerAnalyticsCustomerRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    ownerId: t.exposeID('ownerId'),
    ownerName: t.exposeString('ownerName', { nullable: true }),
    lifetimeValue: t.exposeFloat('lifetimeValue', { nullable: true }),
    churnRiskScore: t.exposeFloat('churnRiskScore', { nullable: true }),
    churnRisk: t.field({
      type: CustomerChurnRiskRef,
      nullable: true,
      resolve: (item) => item.churnRisk,
    }),
    lastActivityDate: t.exposeString('lastActivityDate', { nullable: true }),
    analyticsCalculatedAt: t.exposeString('analyticsCalculatedAt', { nullable: true }),
    recommendedAction: t.field({
      type: CustomerRecommendedActionRef,
      resolve: (item) => item.recommendedAction,
    }),
    isHighLifetimeValue: t.exposeBoolean('isHighLifetimeValue'),
  }),
})

const CustomerAnalyticsCustomerConnectionRef =
  builder.objectRef<CustomerAnalyticsCustomerConnection>('CustomerAnalyticsCustomerConnection')

CustomerAnalyticsCustomerConnectionRef.implement({
  fields: (t) => ({
    items: t.field({ type: [CustomerAnalyticsCustomerRef], resolve: (c) => c.items }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
  }),
})

const CustomerAnalyticsTrendPointRef = builder.objectRef<CustomerAnalyticsTrendPoint>(
  'CustomerAnalyticsTrendPoint',
)

CustomerAnalyticsTrendPointRef.implement({
  fields: (t) => ({
    snapshotDate: t.exposeString('snapshotDate'),
    totalLtv: t.exposeFloat('totalLtv'),
    averageLtv: t.exposeFloat('averageLtv'),
    customerCount: t.exposeInt('customerCount'),
  }),
})

const CustomerAnalyticsCohortRef =
  builder.objectRef<CustomerAnalyticsCohort>('CustomerAnalyticsCohort')

CustomerAnalyticsCohortRef.implement({
  fields: (t) => ({
    cohort: t.exposeString('cohort'),
    customerCount: t.exposeInt('customerCount'),
    totalLtv: t.exposeFloat('totalLtv'),
    averageLtv: t.exposeFloat('averageLtv'),
  }),
})

const CustomerAnalyticsRef = builder.objectRef<CustomerAnalyticsResult>('CustomerAnalytics')

CustomerAnalyticsRef.implement({
  fields: (t) => ({
    summary: t.field({ type: CustomerAnalyticsSummaryRef, resolve: (r) => r.summary }),
    ltvDistribution: t.field({ type: [LtvDistributionBinRef], resolve: (r) => r.ltvDistribution }),
    churnRiskDistribution: t.field({
      type: [ChurnRiskDistributionBinRef],
      resolve: (r) => r.churnRiskDistribution,
    }),
    customers: t.field({
      type: CustomerAnalyticsCustomerConnectionRef,
      resolve: (r) => r.customers,
    }),
    ltvTrend: t.field({ type: [CustomerAnalyticsTrendPointRef], resolve: (r) => r.ltvTrend }),
    cohorts: t.field({ type: [CustomerAnalyticsCohortRef], resolve: (r) => r.cohorts }),
  }),
})

// ─── Input Types (D27: closed, typed — no raw JSON/Prisma where/sort) ─────

const CustomerAnalyticsFilterInputRef = builder.inputType('CustomerAnalyticsFilterInput', {
  fields: (t) => ({
    minLifetimeValue: t.float(),
    maxLifetimeValue: t.float(),
    churnRisks: t.field({ type: [CustomerChurnRiskRef] }),
    lastActivityFrom: t.string(),
    lastActivityTo: t.string(),
    search: t.string(),
    ownerId: t.string(),
  }),
})

const CustomerAnalyticsPaginationInputRef = builder.inputType('CustomerAnalyticsPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service Singleton ─────────────────────────────────────────────────────

let customerAnalyticsService: CustomerAnalyticsService | undefined

function getCustomerAnalyticsService(): CustomerAnalyticsService {
  if (!customerAnalyticsService) {
    throw new Error('CustomerAnalyticsService is not initialized')
  }
  return customerAnalyticsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Queries (D28: REPORT:READ + CONTACT:READ + DEAL:READ) ────────────────

builder.queryFields((t) => ({
  customerAnalytics: t.field({
    type: CustomerAnalyticsRef,
    args: {
      filters: t.arg({ type: CustomerAnalyticsFilterInputRef }),
      pagination: t.arg({ type: CustomerAnalyticsPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      await requirePermission(context, 'CONTACT', 'READ')
      await requirePermission(context, 'DEAL', 'READ')
      return getCustomerAnalyticsService().customerAnalytics(
        user.tenantId,
        user.userId,
        (args.filters as CustomerAnalyticsFilterInput | null | undefined) ?? {},
        (args.pagination as CustomerAnalyticsPaginationInput | null | undefined) ?? {},
      )
    },
  }),
}))

export function registerCustomerAnalyticsGraphql(service: CustomerAnalyticsService): void {
  customerAnalyticsService = service
}
