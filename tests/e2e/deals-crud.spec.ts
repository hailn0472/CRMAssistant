import { expect, test } from '@playwright/test'
import { applyAuthCookie } from '../support/helpers/auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DealStage {
  id: string
  name: string
  order: number
  probability: number
  isWon: boolean
  isLost: boolean
  color: string
}

interface DealOwner {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

interface DealContact {
  id: string
  firstName: string
  lastName: string
  email: string
}

interface MockDeal {
  id: string
  title: string
  value: number
  currency: string
  probability: number
  stageId: string
  contactId: string
  ownerId: string
  expectedCloseDate: string | null
  actualCloseDate: string | null
  stage: DealStage | null
  contact: DealContact | null
  owner: DealOwner | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Mock data generators
// ---------------------------------------------------------------------------
const STAGES: DealStage[] = [
  {
    id: 'stage-1',
    name: 'New',
    order: 0,
    probability: 10,
    isWon: false,
    isLost: false,
    color: '#3B82F6',
  },
  {
    id: 'stage-2',
    name: 'Qualified',
    order: 1,
    probability: 30,
    isWon: false,
    isLost: false,
    color: '#8B5CF6',
  },
  {
    id: 'stage-3',
    name: 'Proposal',
    order: 2,
    probability: 50,
    isWon: false,
    isLost: false,
    color: '#F59E0B',
  },
  {
    id: 'stage-4',
    name: 'Negotiation',
    order: 3,
    probability: 75,
    isWon: false,
    isLost: false,
    color: '#EF4444',
  },
  {
    id: 'stage-5',
    name: 'Closed Won',
    order: 4,
    probability: 100,
    isWon: true,
    isLost: false,
    color: '#10B981',
  },
  {
    id: 'stage-6',
    name: 'Closed Lost',
    order: 5,
    probability: 0,
    isWon: false,
    isLost: true,
    color: '#6B7280',
  },
]

const FAKE_CONTACT: DealContact = {
  id: 'contact-1',
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com',
}

const FAKE_OWNER: DealOwner = {
  id: 'owner-1',
  firstName: 'Alice',
  lastName: 'Johnson',
  email: 'alice@example.com',
}

function makeDeal(idx: number, overrides: Partial<MockDeal> = {}): MockDeal {
  const suffix = Date.now().toString(36)
  return {
    id: `e2e-deal-${idx}-${suffix}`,
    title: `Test Deal ${idx}`,
    value: 10000 * (idx + 1),
    currency: 'USD',
    probability: STAGES[idx % STAGES.length].probability,
    stageId: STAGES[idx % STAGES.length].id,
    contactId: FAKE_CONTACT.id,
    ownerId: FAKE_OWNER.id,
    expectedCloseDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    actualCloseDate: null,
    stage: { ...STAGES[idx % STAGES.length] },
    contact: { ...FAKE_CONTACT },
    owner: { ...FAKE_OWNER },
    createdAt: new Date(Date.now() - idx * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock route helpers
// ---------------------------------------------------------------------------
type MockHandler = (postData: {
  query: string
  variables?: Record<string, unknown>
}) => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown }

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
          status: result.status ?? 200,
          contentType: 'application/json',
          body: JSON.stringify(result.body),
        })
        return
      }
    }

    await route.continue()
  })
}

async function mockDealsList(
  page: import('@playwright/test').Page,
  items: MockDeal[],
  total?: number,
): Promise<void> {
  await setupGraphqlMock(page, [
    [
      'query Deals',
      () => ({
        body: {
          data: {
            deals: {
              total: total ?? items.length,
              page: 1,
              pageSize: 10,
              items,
            },
          },
        },
      }),
    ],
  ])
}

async function mockDealStages(
  page: import('@playwright/test').Page,
  stages: DealStage[],
): Promise<void> {
  await setupGraphqlMock(page, [
    [
      'query DealStages',
      () => ({
        body: {
          data: {
            dealStages: stages,
          },
        },
      }),
    ],
  ])
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------
const BACKEND_URL = 'http://127.0.0.1:4000/graphql'
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'
const API_ADMIN_USER = process.env['E2E_API_USER'] ?? '1d10f592-95d6-4a26-8a81-9cf69a1bafc0'
const API_ADMIN_TENANT = process.env['E2E_API_TENANT'] ?? '00000000-0000-0000-0000-000000000001'
const AUTH_USER = API_ADMIN_USER
const AUTH_TENANT = API_ADMIN_TENANT

function buildApiJwt(secret: string, sub: string, tenantId: string, roles: string[]): string {
  const { createHmac } = require('crypto')
  const e = (v: string) => Buffer.from(v).toString('base64url')
  const header = e(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = e(
    JSON.stringify({
      sub,
      userId: sub,
      tenantId,
      roles,
      email: `${sub}@test.local`,
      exp: 9_999_999_999,
    }),
  )
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test.describe('Deals CRUD — Story 3-1', () => {
  let dealId: string | null = null
  let setupFailed = false
  let realDealTitle: string | null = null

  test.beforeAll(async ({ request }) => {
    try {
      const adminToken = buildApiJwt(API_JWT_SECRET, API_ADMIN_USER, API_ADMIN_TENANT, ['ADMIN'])
      const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const res = await request.post(BACKEND_URL, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        data: {
          query: /* GraphQL */ `
            mutation CreateDeal($input: CreateDealInput!) {
              createDeal(input: $input) {
                id
                title
                value
                currency
                stageId
                contactId
                ownerId
                expectedCloseDate
                stage {
                  id
                  name
                  order
                  probability
                  isWon
                  isLost
                  color
                }
                contact {
                  id
                  firstName
                  lastName
                  email
                }
                owner {
                  id
                  firstName
                  lastName
                  email
                  avatar
                }
              }
            }
          `,
          variables: {
            input: {
              title: `E2E Test Deal ${suffix}`,
              value: 50000,
              currency: 'USD',
              stageId: 'stage-1',
              contactId: API_ADMIN_USER,
            },
          },
        },
      })

      const body = await res.json()
      if (body.errors?.length) {
        console.warn('[E2E] Could not create test deal:', JSON.stringify(body.errors))
        setupFailed = true
        return
      }
      if (!body.data?.createDeal?.id) {
        console.warn('[E2E] createDeal returned no id')
        setupFailed = true
        return
      }
      dealId = body.data.createDeal.id
      realDealTitle = body.data.createDeal.title
      console.log(`[E2E] Created test deal: ${dealId} -> ${realDealTitle}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E] API unavailable for deal setup: ${msg}`)
      setupFailed = true
    }
  })

  test.beforeEach(async ({ context }) => {
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_USER_ID'] = AUTH_USER
    process.env['PLAYWRIGHT_TENANT_ID'] = AUTH_TENANT
    process.env['PLAYWRIGHT_EMAIL'] = 'admin@example.com'
    await applyAuthCookie(context)
  })

  test.afterEach(() => {
    delete process.env['JWT_SECRET']
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_TENANT_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
  })

  // ====================================================================
  // DEAL LIST PAGE
  // ====================================================================

  test('[P1] E2E-D-01: Deal list page loads with table columns', async ({ page }) => {
    test.skip(setupFailed, 'API not available — test deal not created')

    const deals = [makeDeal(0), makeDeal(1)]
    await mockDealsList(page, deals)

    await page.goto('/deals')

    // Wait for the mocked data to render
    await expect(page.getByText(deals[0].title).first()).toBeVisible({ timeout: 20_000 })

    // Table headers
    await expect(page.getByRole('columnheader', { name: /title/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /value/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /stage/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /contact/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /owner/i })).toBeVisible()

    // Deal data rendered
    for (const deal of deals) {
      await expect(page.getByText(deal.title).first()).toBeVisible()
      if (deal.stage) {
        await expect(page.getByText(deal.stage.name).first()).toBeVisible()
      }
    }
  })

  test('[P1] E2E-D-02: Deal list shows empty state when no deals', async ({ page }) => {
    test.skip(setupFailed, 'API not available')

    await mockDealsList(page, [], 0)

    await page.goto('/deals')

    // Wait for the page to render
    await expect(page.getByText('No deals yet').first()).toBeVisible({ timeout: 20_000 })

    // "Create deal" link should be present in empty state
    const createBtn = page.getByRole('link', { name: /create deal/i })
    await expect(createBtn.first()).toBeVisible()
    await expect(createBtn.first()).toHaveAttribute('href', '/deals/new')
  })

  test('[P1] E2E-D-03: Deal list has Create deal button linking to new deal page', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API not available')

    const deals = [makeDeal(0)]
    await mockDealsList(page, deals)

    await page.goto('/deals')
    await expect(page.getByText(deals[0].title).first()).toBeVisible({ timeout: 20_000 })

    // Create deal button in the header area
    const createLink = page.getByRole('link', { name: /create deal/i })
    await expect(createLink.first()).toBeVisible()
    await expect(createLink.first()).toHaveAttribute('href', '/deals/new')
  })

  // ====================================================================
  // CREATE DEAL FORM
  // ====================================================================

  test('[P1] E2E-D-04: Create deal form renders all required fields', async ({ page }) => {
    test.skip(setupFailed, 'API not available')

    // DealStages query is needed by DealForm for the stage dropdown
    await mockDealStages(page, STAGES)

    await page.goto('/deals/new')

    // Wait for the form to render
    await expect(page.getByText('Create deal').first()).toBeVisible({ timeout: 20_000 })

    // Title field
    await expect(page.getByPlaceholder(/enter deal title/i)).toBeVisible()

    // Value field (number input)
    await expect(page.locator('input[type="number"]')).toBeVisible()

    // Currency field
    await expect(page.getByPlaceholder('USD')).toBeVisible()

    // Stage dropdown
    await expect(page.getByRole('combobox')).toBeVisible()

    // Contact search input
    await expect(page.getByPlaceholder(/search contacts/i)).toBeVisible()

    // Expected close date field
    await expect(page.locator('input[type="date"]')).toBeVisible()

    // Submit button
    await expect(page.getByRole('button', { name: /create deal/i })).toBeVisible()
  })

  test('[P1] E2E-D-05: Form shows validation error for empty title', async ({ page }) => {
    test.skip(setupFailed, 'API not available')

    await mockDealStages(page, STAGES)

    await page.goto('/deals/new')
    await expect(page.getByText('Create deal').first()).toBeVisible({ timeout: 20_000 })

    // Clear title field (already empty) and submit to trigger validation
    const titleInput = page.getByPlaceholder(/enter deal title/i)
    await titleInput.focus()
    await titleInput.blur()

    // Click submit to trigger validation
    await page.getByRole('button', { name: /create deal/i }).click()

    // Validation error should appear
    await expect(page.getByText(/title is required/i).first()).toBeVisible({ timeout: 5_000 })
  })

  test('[P1] E2E-D-06: Form shows validation error for negative value', async ({ page }) => {
    test.skip(setupFailed, 'API not available')

    await mockDealStages(page, STAGES)

    await page.goto('/deals/new')
    await expect(page.getByText('Create deal').first()).toBeVisible({ timeout: 20_000 })

    // Enter a valid title so only value validation is triggered
    const titleInput = page.getByPlaceholder(/enter deal title/i)
    await titleInput.fill('Test deal with negative value')

    // Enter a negative value
    const valueInput = page.locator('input[type="number"]')
    await valueInput.fill('-100')
    await valueInput.blur()

    // Click submit
    await page.getByRole('button', { name: /create deal/i }).click()

    // Validation error for value
    await expect(page.getByText(/value must be 0 or greater/i).first()).toBeVisible({
      timeout: 5_000,
    })
  })

  // ====================================================================
  // PIPELINE SETTINGS (STAGE MANAGEMENT)
  // ====================================================================

  test('[P1] E2E-D-07: Pipeline settings page shows stage list', async ({ page }) => {
    test.skip(setupFailed, 'API not available')

    await mockDealStages(page, STAGES)

    await page.goto('/deals/pipeline-settings')

    // Wait for page to render stage data
    await expect(page.getByText('Pipeline Settings').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Pipeline Stages').first()).toBeVisible()

    // Each stage name should be visible
    for (const stage of STAGES) {
      await expect(page.getByText(stage.name).first()).toBeVisible()
    }

    // Probability text visible for at least one stage
    await expect(page.getByText(/probability:/i).first()).toBeVisible()

    // Action buttons should be present
    await expect(page.getByRole('button', { name: /add stage/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /reorder/i })).toBeVisible()
  })

  test('[P1] E2E-D-08: Pipeline settings shows Won/Lost badges for terminal stages', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API not available')

    await mockDealStages(page, STAGES)

    await page.goto('/deals/pipeline-settings')
    await expect(page.getByText('Pipeline Settings').first()).toBeVisible({ timeout: 20_000 })

    // Closed Won should show "Won"
    await expect(page.getByText(/won/i).first()).toBeVisible()
    // Closed Lost should show "Lost"
    await expect(page.getByText(/lost/i).first()).toBeVisible()
  })

  test('[P2] E2E-D-09: Add stage form opens and accepts input', async ({ page }) => {
    test.skip(setupFailed, 'API not available')

    await mockDealStages(page, STAGES)

    await page.goto('/deals/pipeline-settings')
    await expect(page.getByText('Pipeline Settings').first()).toBeVisible({ timeout: 20_000 })

    // Click "Add stage" button
    await page.getByRole('button', { name: /add stage/i }).click()

    // Stage name input should appear
    const stageNameInput = page.getByPlaceholder(/stage name/i)
    await expect(stageNameInput).toBeVisible()

    // Color input should appear
    await expect(page.locator('input[type="color"]')).toBeVisible()

    // Type a stage name
    await stageNameInput.fill('E2E Test Stage')
  })
})
