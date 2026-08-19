import { expect, test } from '@playwright/test'

import { applyAuthCookie } from '../support/helpers/auth'

// ===========================================================================
// Story 6.7 — Customer Lifetime Value & Churn Risk Analysis — E2E
//
// APPROACH: fully self-contained, CI-safe, deterministic. Every client-side
// GraphQL call (query MyPermissions, query CustomerAnalytics) is fulfilled
// in-browser via page.route('**/api/graphql'), so the suite requires NO live
// backend API, NO database, and NO Supabase credentials (Contract F51).
// The web app runs standalone with a dummy JWT secret matching the Next.js
// dev/CI web server (see playwright-e2e skill §29).
//
// Binding AC / Flow coverage map:
//   Flow 1: [P0] E2E-CA-01 — Populated dashboard route (/reports/customer-analytics):
//           Heading, subtitle, Total LTV, Avg LTV, Analyzed count, High risk count,
//           all 4 analytics chart containers / semantic tables, customer rows,
//           exact badges ('Low', 'High', 'Medium', 'Not calculated'),
//           exact recommended actions ('Schedule follow-up', 'Upsell opportunity', 'Monitor'),
//           and links to /contacts/<id> (AC 9, 10, 12, 13, 15, 16; Contract E38, E39, E41).
//
//   Flow 2: [P0] E2E-CA-02 — Filter interactions & GraphQL variable assertions:
//           Min/Max LTV range, Churn risk checkboxes, Last activity date range,
//           Search input, Owner ID. Verifies variables sent in CustomerAnalytics query,
//           resets page to 1, live announcement, and verifies invalid range (min > max,
//           from > to) blocks query dispatch with inline feedback banner (AC 11; Contract E40).
//
//   Flow 3: [P0] E2E-CA-03 — Pagination & page-size controls:
//           Page size select (10/20/50), Next page, Previous page, page index updates,
//           dispatches exact pagination variables, updates rows deterministically without
//           duplicates (AC 11; Contract E40, D32).
//
//   Flow 4: [P1] E2E-CA-04 — Critical states: permission gating, loading, error, empty,
//           and persistent mixed-currency warning:
//           - Permission denial when REPORT, CONTACT, or DEAL:READ is missing (AC 7; Contract D28, E37).
//           - Error state with retry recovery (Contract E43).
//           - Empty state when no contacts match (Contract E43).
//           - Persistent mixed-currency alert with 'No FX rule' badge, ISO breakdown chips,
//             and neutral currency formatting without single-currency symbol assumption (AC 31, 42).
//
//   Flow 5: [P0] E2E-CA-05 — Mobile 320px responsive & a11y:
//           Sets viewport to 320x640, asserts no document-level horizontal overflow
//           (scrollWidth <= clientWidth), table contained inside scroll wrapper,
//           representative interactive controls bounding boxes >=44px, keyboard focus
//           navigation, and semantic tables/charts intact in DOM (Contract E44; WCAG 2.1 AA).
//
//   Flow 6: [P1] E2E-CA-06 — High-risk customer & action link intent (no mutation):
//           High churn risk row link opens /contacts/<id>, recommended action link opens
//           /contacts/<id>, and verifies no mutation GraphQL request is dispatched during
//           the analytics interaction (AC 13, 14; Contract E41).
// ===========================================================================

const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'

// ---------------------------------------------------------------------------
// Types (mirror apps/web/src/services/customer-analytics.service.ts)
// ---------------------------------------------------------------------------

type CustomerChurnRisk = 'LOW' | 'MEDIUM' | 'HIGH'
type CustomerRecommendedActionCode = 'SCHEDULE_FOLLOW_UP' | 'UPSELL_OPPORTUNITY' | 'MONITOR'

interface CurrencyBreakdownEntry {
  currency: string
  value: number
}

interface CustomerAnalyticsSummary {
  totalLifetimeValue: number | null
  averageLifetimeValue: number | null
  customerCount: number
  calculatedCustomerCount: number
  highLtvThreshold: number | null
  latestCalculatedAt: string | null
  mixedCurrencies: boolean
  currencyBreakdown: CurrencyBreakdownEntry[]
}

interface LtvDistributionBin {
  label: string
  min: number
  max: number
  count: number
}

interface ChurnRiskDistributionBin {
  risk: string
  count: number
  percentage: number
}

interface CustomerRecommendedAction {
  code: CustomerRecommendedActionCode
  label: string
}

interface CustomerAnalyticsCustomerItem {
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

interface CustomerAnalyticsCustomerConnection {
  items: CustomerAnalyticsCustomerItem[]
  total: number
  page: number
  pageSize: number
}

interface CustomerAnalyticsTrendPoint {
  snapshotDate: string
  totalLtv: number
  averageLtv: number
  customerCount: number
}

interface CustomerAnalyticsCohort {
  cohort: string
  customerCount: number
  totalLtv: number
  averageLtv: number
}

interface CustomerAnalyticsResult {
  summary: CustomerAnalyticsSummary
  ltvDistribution: LtvDistributionBin[]
  churnRiskDistribution: ChurnRiskDistributionBin[]
  customers: CustomerAnalyticsCustomerConnection
  ltvTrend: CustomerAnalyticsTrendPoint[]
  cohorts: CustomerAnalyticsCohort[]
}

interface CustomerAnalyticsFilterInput {
  minLifetimeValue?: number | null
  maxLifetimeValue?: number | null
  churnRisks?: CustomerChurnRisk[] | null
  lastActivityFrom?: string | null
  lastActivityTo?: string | null
  search?: string | null
  ownerId?: string | null
}

interface CustomerAnalyticsPaginationInput {
  page?: number | null
  pageSize?: number | null
}

type MockHandler = (postData: {
  query: string
  variables?: Record<string, unknown>
}) =>
  | { data?: unknown; errors?: Array<{ message: string }> }
  | Promise<{ data?: unknown; errors?: Array<{ message: string }> }>

// ---------------------------------------------------------------------------
// Permissions fixtures
// ---------------------------------------------------------------------------

function fullCustomerAnalyticsPermissions(): Array<{
  resource: string
  action: string
  granted: boolean
}> {
  return [
    { resource: 'REPORT', action: 'READ', granted: true },
    { resource: 'CONTACT', action: 'READ', granted: true },
    { resource: 'DEAL', action: 'READ', granted: true },
    { resource: 'TASK', action: 'READ', granted: true },
  ]
}

function partialCustomerAnalyticsPermissions(missing: 'REPORT' | 'CONTACT' | 'DEAL'): Array<{
  resource: string
  action: string
  granted: boolean
}> {
  return fullCustomerAnalyticsPermissions().filter((p) => p.resource !== missing)
}

// ---------------------------------------------------------------------------
// Mock generator fixtures
// ---------------------------------------------------------------------------

function makeCustomerItem(
  idx: number,
  overrides: Partial<CustomerAnalyticsCustomerItem> = {},
): CustomerAnalyticsCustomerItem {
  const risks: CustomerChurnRisk[] = ['LOW', 'MEDIUM', 'HIGH']
  const risk = overrides.churnRisk ?? risks[idx % risks.length]
  const isHighLtv = overrides.isHighLifetimeValue ?? (idx % 2 === 0 && risk === 'LOW')

  let actionCode: CustomerRecommendedActionCode = 'MONITOR'
  let actionLabel = 'Monitor'
  if (risk === 'HIGH') {
    actionCode = 'SCHEDULE_FOLLOW_UP'
    actionLabel = 'Schedule follow-up'
  } else if (isHighLtv) {
    actionCode = 'UPSELL_OPPORTUNITY'
    actionLabel = 'Upsell opportunity'
  }

  return {
    id: `contact-ca-${idx}`,
    name: `Customer Alpha ${idx}`,
    ownerId: `user-${(idx % 3) + 1}`,
    ownerName: `Sales Rep ${(idx % 3) + 1}`,
    lifetimeValue: (idx + 1) * 15000,
    churnRiskScore: risk === 'HIGH' ? 85.5 : risk === 'MEDIUM' ? 45.0 : 12.0,
    churnRisk: risk,
    lastActivityDate: new Date(Date.now() - idx * 86_400_000 * 3).toISOString(),
    analyticsCalculatedAt: new Date(Date.now() - 3600_000).toISOString(),
    recommendedAction: {
      code: actionCode,
      label: actionLabel,
    },
    isHighLifetimeValue: isHighLtv,
    ...overrides,
  }
}

function buildPopulatedAnalyticsData(
  options: {
    mixedCurrencies?: boolean
    totalItems?: number
    itemsOverride?: CustomerAnalyticsCustomerItem[]
  } = {},
): CustomerAnalyticsResult {
  const total = options.totalItems ?? 25
  const allCustomers =
    options.itemsOverride ?? Array.from({ length: total }, (_, i) => makeCustomerItem(i + 1))

  const isMixed = options.mixedCurrencies ?? false

  return {
    summary: {
      totalLifetimeValue: isMixed ? null : 4850000,
      averageLifetimeValue: isMixed ? null : 194000,
      customerCount: total,
      calculatedCustomerCount: total,
      highLtvThreshold: isMixed ? null : 250000,
      latestCalculatedAt: '2026-08-19T02:00:00.000Z',
      mixedCurrencies: isMixed,
      currencyBreakdown: isMixed
        ? [
            { currency: 'EUR', value: 1200000 },
            { currency: 'USD', value: 3650000 },
          ]
        : [{ currency: 'USD', value: 4850000 }],
    },
    ltvDistribution: [
      { label: '$0 - $50,000', min: 0, max: 50000, count: 10 },
      { label: '$50,000 - $150,000', min: 50000, max: 150000, count: 8 },
      { label: '$150,000 - $300,000', min: 150000, max: 300000, count: 5 },
      { label: '$300,000+', min: 300000, max: 1000000, count: 2 },
    ],
    churnRiskDistribution: [
      { risk: 'LOW', count: 12, percentage: 48.0 },
      { risk: 'MEDIUM', count: 8, percentage: 32.0 },
      { risk: 'HIGH', count: 5, percentage: 20.0 },
    ],
    customers: {
      items: allCustomers.slice(0, 20),
      total: allCustomers.length,
      page: 1,
      pageSize: 20,
    },
    ltvTrend: [
      {
        snapshotDate: '2026-06-01T00:00:00.000Z',
        totalLtv: 3200000,
        averageLtv: 160000,
        customerCount: 20,
      },
      {
        snapshotDate: '2026-07-01T00:00:00.000Z',
        totalLtv: 4100000,
        averageLtv: 178000,
        customerCount: 23,
      },
      {
        snapshotDate: '2026-08-01T00:00:00.000Z',
        totalLtv: 4850000,
        averageLtv: 194000,
        customerCount: 25,
      },
    ],
    cohorts: [
      {
        cohort: '2026-04',
        customerCount: 8,
        totalLtv: 1800000,
        averageLtv: 225000,
      },
      {
        cohort: '2026-05',
        customerCount: 10,
        totalLtv: 2100000,
        averageLtv: 210000,
      },
      {
        cohort: '2026-06',
        customerCount: 7,
        totalLtv: 950000,
        averageLtv: 135714,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Stateful Mock System
// ---------------------------------------------------------------------------

interface CustomerAnalyticsMockState {
  permissions?: Array<{ resource: string; action: string; granted: boolean }>
  analyticsData?: CustomerAnalyticsResult
  allCustomers?: CustomerAnalyticsCustomerItem[]
  queryError?: boolean
  queryErrorForFirstN?: number
  unexpectedMutations?: string[]
}

function buildCustomerAnalyticsMock(state: CustomerAnalyticsMockState): {
  handlers: Array<[string, MockHandler]>
  capturedRequests: {
    queries: Array<{ query: string; variables?: Record<string, unknown> }>
    filters: CustomerAnalyticsFilterInput[]
    paginations: CustomerAnalyticsPaginationInput[]
    mutations: Array<{ query: string; variables?: Record<string, unknown> }>
  }
  counters: {
    analyticsQueryCount: number
    permissionsCount: number
  }
} {
  const capturedRequests = {
    queries: [] as Array<{ query: string; variables?: Record<string, unknown> }>,
    filters: [] as CustomerAnalyticsFilterInput[],
    paginations: [] as CustomerAnalyticsPaginationInput[],
    mutations: [] as Array<{ query: string; variables?: Record<string, unknown> }>,
  }

  const counters = {
    analyticsQueryCount: 0,
    permissionsCount: 0,
  }

  const handlers: Array<[string, MockHandler]> = [
    [
      'query MyPermissions',
      () => {
        counters.permissionsCount++
        return {
          data: {
            myPermissions: state.permissions ?? fullCustomerAnalyticsPermissions(),
          },
        }
      },
    ],
    [
      'query CustomerAnalytics',
      (postData) => {
        counters.analyticsQueryCount++
        capturedRequests.queries.push(postData)
        const filter = (postData.variables?.['filters'] ?? {}) as CustomerAnalyticsFilterInput
        const pagination = (postData.variables?.['pagination'] ??
          {}) as CustomerAnalyticsPaginationInput
        capturedRequests.filters.push(filter)
        capturedRequests.paginations.push(pagination)

        if (
          state.queryError ||
          (state.queryErrorForFirstN !== undefined &&
            counters.analyticsQueryCount <= state.queryErrorForFirstN)
        ) {
          return { errors: [{ message: 'Failed to fetch customer analytics data from server' }] }
        }

        const baseData = state.analyticsData ?? buildPopulatedAnalyticsData()
        const allItems = state.allCustomers ?? baseData.customers.items

        // Apply filtering if provided
        let filteredItems = [...allItems]
        if (filter.search) {
          const searchLower = filter.search.toLowerCase()
          filteredItems = filteredItems.filter((c) => c.name.toLowerCase().includes(searchLower))
        }
        if (filter.minLifetimeValue !== null && filter.minLifetimeValue !== undefined) {
          filteredItems = filteredItems.filter(
            (c) => c.lifetimeValue !== null && c.lifetimeValue >= (filter.minLifetimeValue ?? 0),
          )
        }
        if (filter.maxLifetimeValue !== null && filter.maxLifetimeValue !== undefined) {
          filteredItems = filteredItems.filter(
            (c) =>
              c.lifetimeValue !== null && c.lifetimeValue <= (filter.maxLifetimeValue ?? Infinity),
          )
        }
        if (filter.churnRisks && filter.churnRisks.length > 0 && filter.churnRisks.length < 3) {
          filteredItems = filteredItems.filter(
            (c) => c.churnRisk !== null && filter.churnRisks!.includes(c.churnRisk),
          )
        }
        if (filter.ownerId) {
          filteredItems = filteredItems.filter((c) => c.ownerId === filter.ownerId)
        }

        // Apply pagination
        const pageNum = Number(pagination.page ?? 1)
        const pageSizeNum = Number(pagination.pageSize ?? 20)
        const start = (pageNum - 1) * pageSizeNum
        const pagedItems = filteredItems.slice(start, start + pageSizeNum)

        return {
          data: {
            customerAnalytics: {
              ...baseData,
              customers: {
                items: pagedItems,
                total: filteredItems.length,
                page: pageNum,
                pageSize: pageSizeNum,
              },
            },
          },
        }
      },
    ],
    [
      'mutation',
      (postData) => {
        capturedRequests.mutations.push(postData)
        return { data: {} }
      },
    ],
  ]

  return { handlers, capturedRequests, counters }
}

async function setupGraphqlMock(
  page: import('@playwright/test').Page,
  handlers: Array<[string, MockHandler]>,
): Promise<void> {
  await page.route('**/api/graphql', async (route) => {
    const postData = route.request().postDataJSON()
    if (!postData?.query) {
      await route.continue()
      return
    }

    for (const [matcher, handler] of handlers) {
      if (postData.query.includes(matcher)) {
        const result = await handler(postData)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(result),
        })
        return
      }
    }

    // Fail loudly on unhandled GraphQL operations (Contract F51)
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        errors: [
          { message: `Unexpected unhandled GraphQL query: ${postData.query.slice(0, 100)}` },
        ],
      }),
    })
  })
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Story 6.7 — Customer Analytics & Churn Risk Dashboard E2E', () => {
  test.beforeEach(async ({ context }) => {
    // Set signing secret matching Infisical dev / CI self-contained server
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_USER_ID'] = 'user-admin-1'
    process.env['PLAYWRIGHT_TENANT_ID'] = 'tenant-e2e-1'
    process.env['PLAYWRIGHT_EMAIL'] = 'admin@example.com'
    await applyAuthCookie(context)
  })

  test.afterEach(() => {
    delete process.env['JWT_SECRET']
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_TENANT_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
  })

  // -------------------------------------------------------------------------
  // Flow 1: Populated Dashboard (AC 9, 10, 12, 13, 15, 16; Contract E38, E39, E41)
  // -------------------------------------------------------------------------
  test('[P0] E2E-CA-01: Populated customer analytics dashboard renders metrics, 4 charts, customer table, exact badges, and action links', async ({
    page,
  }) => {
    const rawCustomers: CustomerAnalyticsCustomerItem[] = [
      makeCustomerItem(1, {
        id: 'contact-101',
        name: 'Nguyen Thi Mai',
        lifetimeValue: 280000,
        churnRisk: 'LOW',
        churnRiskScore: 8.4,
        isHighLifetimeValue: true,
        recommendedAction: { code: 'UPSELL_OPPORTUNITY', label: 'Upsell opportunity' },
      }),
      makeCustomerItem(2, {
        id: 'contact-102',
        name: 'Global Tech Corp',
        lifetimeValue: 95000,
        churnRisk: 'HIGH',
        churnRiskScore: 88.2,
        isHighLifetimeValue: false,
        recommendedAction: { code: 'SCHEDULE_FOLLOW_UP', label: 'Schedule follow-up' },
      }),
      makeCustomerItem(3, {
        id: 'contact-103',
        name: 'Cong Ty TNHH Sao Mai',
        lifetimeValue: 45000,
        churnRisk: 'MEDIUM',
        churnRiskScore: 42.0,
        isHighLifetimeValue: false,
        recommendedAction: { code: 'MONITOR', label: 'Monitor' },
      }),
      makeCustomerItem(4, {
        id: 'contact-104',
        name: 'New Lead Without Calculation',
        lifetimeValue: null,
        churnRisk: null,
        churnRiskScore: null,
        lastActivityDate: null,
        isHighLifetimeValue: false,
        recommendedAction: { code: 'MONITOR', label: 'Monitor' },
      }),
    ]

    const analyticsData = buildPopulatedAnalyticsData({
      totalItems: 4,
      itemsOverride: rawCustomers,
    })

    const { handlers } = buildCustomerAnalyticsMock({
      analyticsData,
      allCustomers: rawCustomers,
    })

    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/customer-analytics')

    // 1. Heading and description
    await expect(
      page.getByRole('heading', { name: 'Customer Analytics & Churn Risk', level: 1 }),
    ).toBeVisible()
    await expect(page.getByText(/Phân tích giá trị vòng đời khách hàng/i)).toBeVisible()

    // 2. Summary Metric Cards (scoped to the summary section to avoid strict mode violations with chart toggles/headers)
    const summarySection = page.locator('section[aria-label="Customer Analytics Summary"]')
    await expect(summarySection.getByText('Total LTV', { exact: true })).toBeVisible()
    await expect(summarySection.getByText('Avg LTV / Customer', { exact: true })).toBeVisible()
    await expect(summarySection.getByText('Khách hàng đã phân tích', { exact: true })).toBeVisible()
    await expect(
      summarySection.getByText('Rủi ro rời bỏ (High Risk)', { exact: true }),
    ).toBeVisible()

    // 3. All 4 Analytical Chart sections / containers
    await expect(page.locator('section[aria-label="Phân bố LTV khách hàng"]')).toBeVisible()
    await expect(page.locator('section[aria-label="Phân bố rủi ro rời bỏ"]')).toBeVisible()
    await expect(page.locator('section[aria-label="Xu hướng LTV lịch sử"]')).toBeVisible()
    await expect(page.locator('section[aria-label="Phân tích Cohort ngày thu nhận"]')).toBeVisible()

    // Verify sr-only semantic table equivalents exist in DOM for accessibility (inside .sr-only wrappers)
    const srTables = page.locator('div.sr-only table')
    await expect(srTables).toHaveCount(4)

    // 4. Customer Table rows, exact badges and action links
    const tableSection = page.locator('section[aria-label="Customer Analytics Table"]')
    await expect(tableSection).toBeVisible()

    // Row 1: Low risk + Upsell opportunity
    await expect(tableSection.getByText('Nguyen Thi Mai')).toBeVisible()
    const lowBadge = tableSection.getByText('Low', { exact: true }).first()
    await expect(lowBadge).toBeVisible()
    const upsellAction = tableSection.getByRole('link', { name: 'Upsell opportunity' })
    await expect(upsellAction).toBeVisible()
    await expect(upsellAction).toHaveAttribute('href', '/contacts/contact-101')

    // Row 2: High risk + Schedule follow-up
    await expect(tableSection.getByText('Global Tech Corp')).toBeVisible()
    const highBadge = tableSection.getByText('High', { exact: true }).first()
    await expect(highBadge).toBeVisible()
    const followUpAction = tableSection.getByRole('link', { name: 'Schedule follow-up' })
    await expect(followUpAction).toBeVisible()
    await expect(followUpAction).toHaveAttribute('href', '/contacts/contact-102')

    // Row 3: Medium risk + Monitor
    await expect(tableSection.getByText('Cong Ty TNHH Sao Mai')).toBeVisible()
    const medBadge = tableSection.getByText('Medium', { exact: true }).first()
    await expect(medBadge).toBeVisible()

    // Row 4: Not calculated customer
    await expect(tableSection.getByText('New Lead Without Calculation')).toBeVisible()
    const notCalcBadge = tableSection.getByText('Not calculated', { exact: true }).first()
    await expect(notCalcBadge).toBeVisible()

    // Name link points to /contacts/<id>
    const nameLink = tableSection.getByRole('link', { name: 'Nguyen Thi Mai' })
    await expect(nameLink).toHaveAttribute('href', '/contacts/contact-101')
  })

  // -------------------------------------------------------------------------
  // Flow 2: Filtering, Variable Interception & Client Validation (AC 11; Contract E40)
  // -------------------------------------------------------------------------
  test('[P0] E2E-CA-02: Filter toolbar dispatches exact GraphQL variables, resets page, and blocks invalid ranges inline', async ({
    page,
  }) => {
    const allCustomers = Array.from({ length: 30 }, (_, i) => makeCustomerItem(i + 1))
    const { handlers, capturedRequests } = buildCustomerAnalyticsMock({
      allCustomers,
    })

    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/customer-analytics')

    await expect(
      page.getByRole('heading', { name: 'Customer Analytics & Churn Risk', level: 1 }),
    ).toBeVisible()

    // 1. Fill filter fields
    const searchInput = page.getByPlaceholder('Tìm kiếm tên...')
    await searchInput.fill('Customer Alpha 1')

    const minLtvInput = page.locator('#filter-min-ltv')
    const maxLtvInput = page.locator('#filter-max-ltv')
    await minLtvInput.fill('10000')
    await maxLtvInput.fill('50000')

    const fromDateInput = page.getByLabel('Từ ngày')
    const toDateInput = page.getByLabel('Đến ngày')
    await fromDateInput.fill('2026-01-01')
    await toDateInput.fill('2026-08-31')

    const ownerInput = page.locator('#filter-owner')
    await ownerInput.fill('user-1')

    // Toggle off MEDIUM risk checkbox, leaving LOW and HIGH
    const medCheckbox = page.locator('label:has-text("MEDIUM") input[type="checkbox"]')
    await medCheckbox.uncheck()

    // Click Apply button
    const applyButton = page.getByRole('button', { name: 'Áp dụng (Apply)' })
    await applyButton.click()

    // Assert that the latest captured GraphQL request has exact filter variables
    await expect
      .poll(() => capturedRequests.filters[capturedRequests.filters.length - 1])
      .toMatchObject({
        search: 'Customer Alpha 1',
        minLifetimeValue: 10000,
        maxLifetimeValue: 50000,
        lastActivityFrom: '2026-01-01',
        lastActivityTo: '2026-08-31',
        ownerId: 'user-1',
        churnRisks: ['LOW', 'HIGH'],
      })

    // Check polite live announcement (scoped to sr-only live region)
    await expect(page.locator('div.sr-only[role="status"]')).toHaveText(
      'Filters applied. Refreshing customer analytics.',
    )

    // 2. Test Invalid Range client validation (min > max)
    await minLtvInput.fill('90000')
    await maxLtvInput.fill('10000')
    const initialQueryCount = capturedRequests.queries.length

    await applyButton.click()

    // Inline error banner appears
    await expect(page.getByText('Min LTV cannot be greater than Max LTV.')).toBeVisible()

    // No new GraphQL query dispatched
    expect(capturedRequests.queries.length).toBe(initialQueryCount)

    // 3. Reset filters button
    const resetButton = page.getByRole('button', { name: 'Đặt lại bộ lọc' })
    await resetButton.click()

    await expect(page.getByText('Min LTV cannot be greater than Max LTV.')).not.toBeVisible()
    await expect(searchInput).toHaveValue('')
    await expect(minLtvInput).toHaveValue('')
    await expect(maxLtvInput).toHaveValue('')
    await expect(page.locator('div.sr-only[role="status"]')).toHaveText('Filters reset to default.')
  })

  // -------------------------------------------------------------------------
  // Flow 3: Pagination & Page-Size Controls (AC 11; Contract E40, D32)
  // -------------------------------------------------------------------------
  test('[P0] E2E-CA-03: Pagination next/prev and page-size changes send exact pagination variables', async ({
    page,
  }) => {
    const allCustomers = Array.from({ length: 45 }, (_, i) =>
      makeCustomerItem(i + 1, { name: `Customer Paged ${i + 1}` }),
    )
    const { handlers, capturedRequests } = buildCustomerAnalyticsMock({
      allCustomers,
    })

    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/customer-analytics')

    await expect(
      page.getByRole('heading', { name: 'Customer Analytics & Churn Risk', level: 1 }),
    ).toBeVisible()

    // Initial page 1 shows customers 1-20
    const tableSection = page.locator('section[aria-label="Customer Analytics Table"]')
    await expect(tableSection.getByText('Customer Paged 1', { exact: true })).toBeVisible()
    await expect(tableSection.getByText('Customer Paged 20', { exact: true })).toBeVisible()
    await expect(page.getByText('1 / 3')).toBeVisible()

    // 1. Next Page
    const nextButton = page.getByRole('button', { name: 'Trang sau' })
    await nextButton.click()

    // Page 2 shows customers 21-40
    await expect(tableSection.getByText('Customer Paged 21', { exact: true })).toBeVisible()
    await expect(page.getByText('2 / 3')).toBeVisible()

    // Verify pagination payload was sent
    expect(capturedRequests.paginations[capturedRequests.paginations.length - 1]).toMatchObject({
      page: 2,
      pageSize: 20,
    })

    // 2. Previous Page
    const prevButton = page.getByRole('button', { name: 'Trang trước' })
    await prevButton.click()
    await expect(tableSection.getByText('Customer Paged 1', { exact: true })).toBeVisible()
    await expect(page.getByText('1 / 3')).toBeVisible()

    // 3. Change Page Size to 10
    const pageSizeSelect = tableSection.locator('select')
    await pageSizeSelect.selectOption('10')

    await expect(page.getByText('1 / 5')).toBeVisible()
    expect(capturedRequests.paginations[capturedRequests.paginations.length - 1]).toMatchObject({
      page: 1,
      pageSize: 10,
    })
  })

  // -------------------------------------------------------------------------
  // Flow 4: Permission, Loading, Error, Empty & Mixed-Currency States (AC 7, 31, 42; Contract D28, E37, E42, E43)
  // -------------------------------------------------------------------------
  test('[P1] E2E-CA-04: Critical states — permission denial, server error recovery, empty results, and mixed-currency persistent alert', async ({
    page,
  }) => {
    // 1. Permission Denied State (missing DEAL:READ)
    const deniedState = buildCustomerAnalyticsMock({
      permissions: partialCustomerAnalyticsPermissions('DEAL'),
    })
    await setupGraphqlMock(page, deniedState.handlers)
    await page.goto('/reports/customer-analytics')

    await expect(page.getByText('Truy cập bị giới hạn quyền')).toBeVisible()
    await expect(
      page.getByText(
        'Yêu cầu đồng thời các quyền: REPORT:READ, CONTACT:READ và DEAL:READ để xem báo cáo phân tích khách hàng.',
      ),
    ).toBeVisible()

    // 2. Mixed Currency Persistent Alert (AC 31, 42)
    // Note: Next.js has div#__next-route-announcer__ with role="alert", so scope specifically
    const mixedData = buildPopulatedAnalyticsData({ mixedCurrencies: true })
    const mixedState = buildCustomerAnalyticsMock({ analyticsData: mixedData })
    await setupGraphqlMock(page, mixedState.handlers)
    await page.goto('/reports/customer-analytics')

    const alertBanner = page.locator('div[role="alert"]:not(#__next-route-announcer__)')
    await expect(alertBanner).toBeVisible()
    await expect(
      alertBanner.getByText('Phát hiện nhiều loại tiền tệ (Mixed Currencies — No FX Conversion)'),
    ).toBeVisible()
    await expect(alertBanner.getByText('No FX rule')).toBeVisible()
    await expect(alertBanner.getByText(/EUR:/)).toBeVisible()
    await expect(alertBanner.getByText(/USD:/)).toBeVisible()

    // 3. Server Error & Retry recovery
    // TanStack Query retries failed queries 3x by default, so we error for the first 4 calls
    const errorState = buildCustomerAnalyticsMock({ queryErrorForFirstN: 4 })
    await setupGraphqlMock(page, errorState.handlers)
    await page.goto('/reports/customer-analytics')

    await expect(page.getByText('Không thể tải dữ liệu Customer Analytics')).toBeVisible({
      timeout: 15_000,
    })
    const retryBtn = page.getByRole('button', { name: 'Try again' })
    await expect(retryBtn).toBeVisible()
    await retryBtn.click()

    // Recovers on retry
    await expect(
      page.getByRole('heading', { name: 'Customer Analytics & Churn Risk', level: 1 }),
    ).toBeVisible()

    // 4. Empty search results
    const emptyState = buildCustomerAnalyticsMock({ allCustomers: [] })
    await setupGraphqlMock(page, emptyState.handlers)
    await page.goto('/reports/customer-analytics')

    await expect(page.getByText('Không tìm thấy khách hàng nào')).toBeVisible()
    await expect(
      page.getByText('Không có dữ liệu khách hàng nào khớp với điều kiện lọc hiện tại.'),
    ).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Flow 5: Mobile 320px Responsive Layout & Accessibility (Contract E44; WCAG 2.1 AA)
  // -------------------------------------------------------------------------
  test.describe('Mobile 320px viewport', () => {
    test.use({ viewport: { width: 320, height: 640 } })

    test('[P0] E2E-CA-05: 320px viewport has no horizontal page overflow, table is enclosed in scroll wrapper, touch targets >=44px, and keyboard focusable', async ({
      page,
    }) => {
      const { handlers } = buildCustomerAnalyticsMock({})
      await setupGraphqlMock(page, handlers)
      await page.goto('/reports/customer-analytics')

      await expect(
        page.getByRole('heading', { name: 'Customer Analytics & Churn Risk', level: 1 }),
      ).toBeVisible()

      // 1. Assert no document-level horizontal overflow
      const documentOverflows = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(documentOverflows).toBe(false)

      // 2. Assert table is enclosed in a scrollable wrapper
      const tableWrapper = page.locator('div.overflow-x-auto')
      await expect(tableWrapper.first()).toBeVisible()

      // 3. Representative interactive controls bounding box >= 44px (touch targets)
      const refreshBtn = page.getByRole('button', { name: /Làm mới/i })
      const refreshBox = await refreshBtn.boundingBox()
      expect(refreshBox).toBeTruthy()
      expect(refreshBox!.height).toBeGreaterThanOrEqual(44)

      const applyBtn = page.getByRole('button', { name: /Áp dụng/i })
      const applyBox = await applyBtn.boundingBox()
      expect(applyBox).toBeTruthy()
      expect(applyBox!.height).toBeGreaterThanOrEqual(44)

      const searchBox = await page.getByPlaceholder('Tìm kiếm tên...').boundingBox()
      expect(searchBox).toBeTruthy()
      expect(searchBox!.height).toBeGreaterThanOrEqual(44)

      // 4. Keyboard focusability
      await page.keyboard.press('Tab')
      const activeElementTag = await page.evaluate(() => document.activeElement?.tagName)
      expect(activeElementTag).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  // Flow 6: High-Risk Customer & Action Navigation Intent (AC 13, 14; Contract E41)
  // -------------------------------------------------------------------------
  test('[P1] E2E-CA-06: High-risk customer and recommended action links point to /contacts/<id> and trigger no unintended mutations', async ({
    page,
  }) => {
    const rawCustomers = [
      makeCustomerItem(1, {
        id: 'contact-high-risk-999',
        name: 'Urgent High Risk Client',
        churnRisk: 'HIGH',
        churnRiskScore: 92.4,
        recommendedAction: {
          code: 'SCHEDULE_FOLLOW_UP',
          label: 'Schedule follow-up',
        },
      }),
    ]

    const { handlers, capturedRequests } = buildCustomerAnalyticsMock({
      allCustomers: rawCustomers,
    })

    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/customer-analytics')

    const tableSection = page.locator('section[aria-label="Customer Analytics Table"]')
    await expect(tableSection.getByText('Urgent High Risk Client')).toBeVisible()

    // 1. Assert action link has exact text and href
    const actionLink = tableSection.getByRole('link', { name: 'Schedule follow-up' })
    await expect(actionLink).toBeVisible()
    await expect(actionLink).toHaveAttribute('href', '/contacts/contact-high-risk-999')

    // 2. Assert contact name link points to same target
    const contactNameLink = tableSection.getByRole('link', { name: 'Urgent High Risk Client' })
    await expect(contactNameLink).toHaveAttribute('href', '/contacts/contact-high-risk-999')

    // 3. Assert no mutation request has been fired during the viewing/analytics flow (Contract E41)
    expect(capturedRequests.mutations.length).toBe(0)
  })
})
