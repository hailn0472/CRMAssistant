import { expect, test } from '@playwright/test'
import { applyAuthCookie, createTestJwt } from '../support/helpers/auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MockNode {
  id: string
  contactId: string
  type: string
  title: string
  description: string | null
  createdAt: string
  createdBy: string
}

interface MockEdge {
  cursor: string
  node: MockNode
}

// ---------------------------------------------------------------------------
// Mock data generators
// ---------------------------------------------------------------------------
const ACTIVITY_TYPES = [
  'NOTE_ADDED',
  'CALL_MADE',
  'EMAIL_SENT',
  'MEETING_SCHEDULED',
  'DEAL_CREATED',
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
] as const

const SALES_TYPES = ['NOTE_ADDED', 'CALL_MADE', 'EMAIL_SENT', 'MEETING_SCHEDULED']
const SYSTEM_TYPES = ['DEAL_CREATED', 'CONTACT_CREATED', 'CONTACT_UPDATED']

function activityIndexToType(i: number): string {
  return ACTIVITY_TYPES[i % ACTIVITY_TYPES.length]
}

function createMockNode(idx: number, contactId: string, type?: string): MockNode {
  const t = type ?? activityIndexToType(idx)
  const hourOffset = idx + 1
  return {
    id: `e2e-act-${idx + 1}`,
    contactId,
    type: t,
    title: t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    description:
      idx % 3 === 0 ? `Automated test — activity #${idx + 1} created for E2E validation` : null,
    createdAt: new Date(Date.now() - hourOffset * 3_600_000).toISOString(),
    createdBy: 'E2E Tester',
  }
}

function createMockEdges(count: number, contactId: string, startIndex = 0): MockEdge[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = startIndex + i
    const node = createMockNode(idx, contactId)
    return { cursor: `cursor-${idx + 1}`, node }
  })
}

function createTypeSpecificEdges(
  count: number,
  contactId: string,
  types: readonly string[],
  startIndex = 0,
): MockEdge[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = startIndex + i
    const t = types[i % types.length]
    const node = createMockNode(idx, contactId, t)
    return { cursor: `cursor-${idx + 1}`, node }
  })
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

/**
 * Setup a mock that returns the given timeline edges for any contactTimeline query.
 */
async function mockTimeline(
  page: import('@playwright/test').Page,
  edges: MockEdge[],
  hasNextPage = false,
  endCursor: string | null = null,
  totalCount?: number,
): Promise<void> {
  await setupGraphqlMock(page, [
    [
      'contactTimeline', // matches ContactTimeline query
      () => ({
        body: {
          data: {
            contactTimeline: {
              edges,
              pageInfo: { hasNextPage, endCursor },
              totalCount: totalCount ?? edges.length,
            },
          },
        },
      }),
    ],
    [
      'AddContactNote',
      (postData) => {
        const vars = postData.variables ?? {}
        const now = new Date().toISOString()
        return {
          body: {
            data: {
              addContactNote: {
                id: `e2e-note-${Date.now()}`,
                contactId: vars.contactId,
                type: 'NOTE_ADDED',
                title: vars.title ?? 'Test Note',
                description: vars.description ?? null,
                createdAt: now,
                createdBy: 'E2E Tester',
              },
            },
          },
        }
      },
    ],
  ])
}

/**
 * Setup a mock that returns an empty timeline.
 */
async function mockEmptyTimeline(page: import('@playwright/test').Page): Promise<void> {
  await mockTimeline(page, [], false, null, 0)
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------
const BACKEND_URL = 'http://127.0.0.1:4000/graphql'
const CONTACT_FIRST_NAME = 'Timeline-E2E'

// The API signs JWTs with its own JWT_SECRET (loaded from Infisical).
// Pass API_JWT_SECRET=<value> when running tests, or override below.
// The Playwright web server uses 'playwright-test-secret-min-32-chars!!'.
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'

// Admin credentials for API setup — this tenant/user must exist in the DB.
const API_ADMIN_USER = process.env['E2E_API_USER'] ?? '1d10f592-95d6-4a26-8a81-9cf69a1bafc0'
const API_ADMIN_TENANT = process.env['E2E_API_TENANT'] ?? '00000000-0000-0000-0000-000000000001'

// Override user/tenant so the auth cookie uses the right identity.
// We set these per-worker — applyAuthCookie reads them from env.
const AUTH_USER = API_ADMIN_USER
const AUTH_TENANT = API_ADMIN_TENANT

/** Build a JWT for the API with full control over sub/tenant/roles. */
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
test.describe('Contact Timeline — Story 5.4', () => {
  let contactId: string | null = null
  let setupFailed = false

  test.beforeAll(async ({ request }) => {
    // Create a real contact via the API so the SSR contact detail page loads
    try {
      // Use ADMIN role so permission checks are bypassed during contact creation
      const adminToken = buildApiJwt(API_JWT_SECRET, API_ADMIN_USER, API_ADMIN_TENANT, ['ADMIN'])
      const suffix = Date.now().toString(36)
      const res = await request.post(BACKEND_URL, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        data: {
          query: /* GraphQL */ `
            mutation CreateContact($input: CreateContactInput!) {
              createContact(input: $input) {
                id
                email
                firstName
                lastName
              }
            }
          `,
          variables: {
            input: {
              email: `e2e-timeline-${suffix}@test.local`,
              firstName: CONTACT_FIRST_NAME,
              lastName: `Test-${suffix}`,
            },
          },
        },
      })

      const body = await res.json()
      if (body.errors?.length) {
        console.warn(
          '[E2E] Could not create test contact (API errors):',
          JSON.stringify(body.errors),
        )
        setupFailed = true
        return
      }
      if (!body.data?.createContact?.id) {
        console.warn('[E2E] createContact returned no id')
        setupFailed = true
        return
      }
      contactId = body.data.createContact.id
      console.log(`[E2E] Created test contact: ${contactId}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E] API unavailable for contact setup: ${msg}`)
      setupFailed = true
    }
  })

  test.beforeEach(async ({ context }) => {
    // Set env vars so applyAuthCookie generates a token the servers accept.
    // These are cleaned up after each test to avoid leaking to other specs.
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_USER_ID'] = AUTH_USER
    process.env['PLAYWRIGHT_TENANT_ID'] = AUTH_TENANT
    process.env['PLAYWRIGHT_EMAIL'] = 'admin@example.com'

    await applyAuthCookie(context)
  })

  test.afterEach(() => {
    // Unset env vars to avoid cross-test pollution
    delete process.env['JWT_SECRET']
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_TENANT_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
  })

  // ====================================================================
  // E2E-01: Timeline section renders on contact detail page
  // ====================================================================
  test('[P1] E2E-01: Timeline section renders on contact detail page', async ({ page }) => {
    test.skip(setupFailed, 'API not available — test contact not created')
    test.skip(!contactId, 'Contact ID not available')

    const edges = createMockEdges(4, contactId!)
    await mockTimeline(page, edges, false, null)
    await page.goto(`/contacts/${contactId!}`)

    // Wait for the timeline section heading to be visible
    const heading = page.getByRole('heading', { name: /activity timeline/i })
    await expect(heading).toBeVisible({ timeout: 20_000 })

    // Header includes activity count e.g. "(1 activity)" or "(N activities)"
    await expect(page.getByText(/^\s*\(/).first()).toBeVisible({ timeout: 5_000 })

    // "Add Note" button is present
    await expect(page.getByRole('button', { name: /add note/i })).toBeVisible()

    // Filter tabs are visible
    await expect(page.getByRole('button', { name: /^all$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^sales$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^system$/i })).toBeVisible()
  })

  // ====================================================================
  // E2E-02: Timeline loads first batch of activities automatically
  // ====================================================================
  test('[P1] E2E-02: Timeline loads activities on page load', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    const edges = createMockEdges(5, contactId!)
    await mockTimeline(page, edges)

    await page.goto(`/contacts/${contactId!}`)

    // Wait for activity cards to render
    await expect(page.getByText(/e2e tester/i).first()).toBeVisible({ timeout: 15_000 })

    // Verify multiple cards are rendered
    const cards = page.locator('h4').filter({ hasText: /^[A-Z]/ })
    await expect(cards).toHaveCount(5)
  })

  // ====================================================================
  // E2E-03: Loading skeleton during initial fetch
  // ====================================================================
  test('[P2] E2E-03: Loading skeleton visible during initial load', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    // Delay the API response to keep skeleton visible long enough to assert
    await page.route('**/api/graphql', async (route) => {
      const postData = route.request().postDataJSON()
      if (postData?.query?.includes('contactTimeline')) {
        await new Promise((r) => setTimeout(r, 2_000))
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              contactTimeline: {
                edges: [],
                pageInfo: { hasNextPage: false, endCursor: null },
                totalCount: 0,
              },
            },
          }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto(`/contacts/${contactId!}`)

    // Skeleton is rendered as divs with animate-pulse class
    // The skeleton container is the loading state of ContactTimeline
    // It contains multiple animate-pulse divs
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 5_000 })

    // Wait for skeleton to disappear after data loads
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 10_000 })
  })

  // ====================================================================
  // E2E-04: Empty timeline state for new contact with no activities
  // ====================================================================
  test('[P1] E2E-04: Empty state visible when no activities exist', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    await mockEmptyTimeline(page)
    await page.goto(`/contacts/${contactId!}`)

    // Should show the empty state message
    await expect(page.getByText(/no activity recorded yet/i)).toBeVisible({ timeout: 15_000 })

    // Add Note button still visible in empty state
    await expect(page.getByRole('button', { name: /add note/i })).toBeVisible()
  })

  // ====================================================================
  // E2E-05: Activity cards display correct icon, title, description,
  //         timestamp and createdBy
  // ====================================================================
  test('[P1] E2E-05: Activity cards show icon, title, description, time, user', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    const edges = createMockEdges(3, contactId!)
    await mockTimeline(page, edges)

    await page.goto(`/contacts/${contactId!}`)

    // Wait for cards to appear
    const userLabel = page.getByText(/by e2e tester/i).first()
    await expect(userLabel).toBeVisible({ timeout: 15_000 })

    // Each card has an h4 with the activity title
    const firstTitle = edges[0].node.title
    await expect(page.getByRole('heading', { name: firstTitle })).toBeVisible()

    // Description shown for every 3rd activity (our mock creates desc for idx % 3 === 0)
    const descActivity = edges.find((e) => e.node.description)
    if (descActivity) {
      await expect(page.getByText(descActivity.node.description!)).toBeVisible()
    }

    // Activity icons are rendered as circular divs (rounded-full)
    const iconContainers = page.locator('.rounded-full')
    await expect(iconContainers.first()).toBeVisible()

    // Relative timestamps (e.g. "X hours ago" or "just now")
    await expect(page.locator('time').first()).toBeVisible()
  })

  // ====================================================================
  // E2E-06: Infinite scroll — scroll to bottom loads next batch
  // ====================================================================
  test('[P1] E2E-06: Infinite scroll loads more activities when scrolling', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    // First page: 5 items with hasNextPage=true
    const page1 = createMockEdges(5, contactId!, 0)
    // Second page: 3 more items
    const page2 = createMockEdges(3, contactId!, 5)

    let callCount = 0

    await setupGraphqlMock(page, [
      [
        'contactTimeline',
        () => {
          callCount++
          // First 2 calls return page1 (React StrictMode double-invokes effects)
          if (callCount <= 2) {
            return {
              body: {
                data: {
                  contactTimeline: {
                    edges: page1,
                    pageInfo: { hasNextPage: true, endCursor: 'cursor-5' },
                    totalCount: 8,
                  },
                },
              },
            }
          }
          return {
            body: {
              data: {
                contactTimeline: {
                  edges: page2,
                  pageInfo: { hasNextPage: false, endCursor: 'cursor-8' },
                  totalCount: 8,
                },
              },
            },
          }
        },
      ],
      [
        'AddContactNote',
        () => ({
          body: {
            data: {
              addContactNote: {
                id: 'mock-note',
                contactId: contactId!,
                type: 'NOTE_ADDED',
                title: 'Mock Note',
                description: null,
                createdAt: new Date().toISOString(),
                createdBy: 'E2E Tester',
              },
            },
          },
        }),
      ],
    ])

    await page.goto(`/contacts/${contactId!}`)

    // Wait for data to load — check for the first activity card
    await expect(page.getByText(/e2e tester/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // The sentinel is visible as a small spacer when hasNextPage=true but
    // isLoadingMore=false.  We scroll it into view to trigger fetchMore.
    // Playwright's scrollIntoViewIfNeeded doesn't work on a 16px element
    // that is already technically "visible", so we scroll the whole page.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    // After scrolling, the IntersectionObserver triggers fetchMore.
    // Wait for the next batch to complete and "No more activities" to appear.
    // The loading indicator transitions too quickly to reliably assert on.
    await expect(page.getByText(/no more activities/i)).toBeVisible({ timeout: 10_000 })
  })

  // ====================================================================
  // E2E-07: "No more activities" message at end of timeline
  // ====================================================================
  test('[P2] E2E-07: "No more activities" shown when all loaded', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    // A small set with hasNextPage=false
    const edges = createMockEdges(3, contactId!)
    await mockTimeline(page, edges, false, null)

    await page.goto(`/contacts/${contactId!}`)

    // Wait for initial data
    await expect(page.getByText(/by e2e tester/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // "No more activities" should appear immediately since hasNextPage=false
    await expect(page.getByText(/no more activities/i)).toBeVisible({ timeout: 5_000 })
  })

  // ====================================================================
  // E2E-08: Click "Add Note" → inline textarea appears
  // ====================================================================
  test('[P1] E2E-08: Add Note button opens inline note composer', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    await mockEmptyTimeline(page)
    await page.goto(`/contacts/${contactId!}`)

    // Click Add Note
    const addNoteBtn = page.getByRole('button', { name: /add note/i })
    await expect(addNoteBtn).toBeVisible({ timeout: 15_000 })
    await addNoteBtn.click()

    // Textarea with aria-label "Note text" should appear
    await expect(page.getByRole('textbox', { name: /note text/i })).toBeVisible()

    // Character counter should appear
    await expect(page.getByText(/0\/1000/)).toBeVisible()

    // Save button should be disabled initially (empty)
    await expect(page.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  // ====================================================================
  // E2E-09: Type note → Save → note appears in timeline
  // ====================================================================
  test('[P1] E2E-09: Type a note, save it, and see it appear instantly', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    const edges = createMockEdges(3, contactId!)
    await mockTimeline(page, edges, false, null)

    await page.goto(`/contacts/${contactId!}`)

    // Wait for initial data
    await expect(page.getByText(/by e2e tester/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // Open note composer
    await page.getByRole('button', { name: /add note/i }).click()
    await expect(page.getByRole('textbox', { name: /note text/i })).toBeVisible()

    // Type a note
    const noteText = 'This is an E2E test note — checking the full flow.'
    await page.getByRole('textbox', { name: /note text/i }).fill(noteText)

    // Save should be enabled
    const saveBtn = page.getByRole('button', { name: /^save$/i })
    await expect(saveBtn).toBeEnabled()

    // Click Save
    await saveBtn.click()

    // The note should appear in the timeline (optimistic update) — use role to avoid
    // strict-mode ambiguity (both the card title h4 and the description p match).
    await expect(page.getByRole('heading', { name: noteText })).toBeVisible({ timeout: 5_000 })
  })

  // ====================================================================
  // E2E-10: Submit empty note → button disabled
  // ====================================================================
  test('[P2] E2E-10: Save button disabled when note text is empty', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    await mockEmptyTimeline(page)
    await page.goto(`/contacts/${contactId!}`)

    // Open composer
    await page.getByRole('button', { name: /add note/i }).click()

    // Save button should be disabled (empty textarea)
    await expect(page.getByRole('button', { name: /^save$/i })).toBeDisabled()

    // Character count shows 0/1000
    await expect(page.getByText('0/1000')).toBeVisible()
  })

  // ====================================================================
  // E2E-11: Type > 1000 characters → Save disabled + counter in red
  // ====================================================================
  test('[P2] E2E-11: Character limit enforcement — Save disabled > 1000 chars', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    await mockEmptyTimeline(page)
    await page.goto(`/contacts/${contactId!}`)

    // Open composer
    await page.getByRole('button', { name: /add note/i }).click()

    const noteTextarea = page.getByRole('textbox', { name: /note text/i })
    await expect(noteTextarea).toBeVisible()

    // Type 1001 characters
    const longText = 'A'.repeat(1001)
    await noteTextarea.fill(longText)

    // Counter should show something like "1001/1000"
    await expect(page.getByText(/1001\/1000/)).toBeVisible()

    // Save button should be disabled
    await expect(page.getByRole('button', { name: /^save$/i })).toBeDisabled()

    // Counter text should be red (text-red-600 class applied)
    // We check the spans that contain the counter
    const counter = page.locator('span').filter({ hasText: /1001\/1000/ })
    await expect(counter).toHaveClass(/text-red-600/)
  })

  // ====================================================================
  // E2E-12: Network failure on note save → error toast
  // ====================================================================
  test('[P2] E2E-12: Failed note mutation shows error toast', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    const edges = createMockEdges(2, contactId!)
    // Set up mock that returns error for AddContactNote
    await setupGraphqlMock(page, [
      [
        'contactTimeline',
        () => ({
          body: {
            data: {
              contactTimeline: {
                edges,
                pageInfo: { hasNextPage: false, endCursor: null },
                totalCount: edges.length,
              },
            },
          },
        }),
      ],
      [
        'AddContactNote',
        () => ({
          status: 200,
          body: {
            errors: [{ message: 'Failed to create note' }],
          },
        }),
      ],
    ])

    await page.goto(`/contacts/${contactId!}`)

    // Open composer and submit
    await page.getByRole('button', { name: /add note/i }).click()
    await page.getByRole('textbox', { name: /note text/i }).fill('This note will fail to save')
    await page.getByRole('button', { name: /^save$/i }).click()

    // Toast should appear with error message
    // The app uses react-hot-toast which renders toast containers
    await expect(page.getByText(/failed to save note|failed to create note/i)).toBeVisible({
      timeout: 5_000,
    })
  })

  // ====================================================================
  // E2E-13/14/15: Filter tabs — All / Sales / System
  // ====================================================================
  test('[P1] E2E-13/14/15: Filter tabs correctly filter activities', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    // Create a set of activities that includes both SALES and SYSTEM types
    // We'll create 6 activities with mixed types
    const allEdges = createMockEdges(6, contactId!, 0)

    // Ensure they have a good mix: indices 0-4 include both SALES and SYSTEM types
    // Override some types explicitly
    const mixedEdges: MockEdge[] = [
      { cursor: 'c-1', node: { ...allEdges[0].node, type: 'NOTE_ADDED' } },
      { cursor: 'c-2', node: { ...allEdges[1].node, type: 'CALL_MADE' } },
      { cursor: 'c-3', node: { ...allEdges[2].node, type: 'CONTACT_CREATED' } },
      { cursor: 'c-4', node: { ...allEdges[3].node, type: 'EMAIL_SENT' } },
      { cursor: 'c-5', node: { ...allEdges[4].node, type: 'DEAL_CREATED' } },
      { cursor: 'c-6', node: { ...allEdges[5].node, type: 'NOTE_ADDED' } },
    ]

    await mockTimeline(page, mixedEdges, false, null)

    await page.goto(`/contacts/${contactId!}`)

    // Wait for activities to load
    await expect(page.getByText(/by e2e tester/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // --- Default: "All" filter ---
    // All 6 activities should be visible
    const allCards = page.locator('h4')
    // We check that specific titles are visible
    for (const edge of mixedEdges) {
      await expect(page.getByRole('heading', { name: edge.node.title })).toBeVisible()
    }

    // --- Click "Sales" filter ---
    await page.getByRole('button', { name: /^sales$/i }).click()
    await page.waitForTimeout(300) // allow filter state to update

    // Sales activities: NOTE_ADDED, CALL_MADE, EMAIL_SENT, MEETING_SCHEDULED
    // Our mixed set has: NOTE_ADDED (c-1), CALL_MADE (c-2), EMAIL_SENT (c-4), NOTE_ADDED (c-6) = 4 sales
    // System: CONTACT_CREATED (c-3), DEAL_CREATED (c-5)
    const salesEdges = mixedEdges.filter((e) =>
      SALES_TYPES.includes(e.node.type as (typeof SALES_TYPES)[number]),
    )
    const systemEdges = mixedEdges.filter((e) =>
      SYSTEM_TYPES.includes(e.node.type as (typeof SYSTEM_TYPES)[number]),
    )

    // Sales activities should be visible
    for (const edge of salesEdges) {
      await expect(page.getByRole('heading', { name: edge.node.title })).toBeVisible()
    }
    // System activities should be hidden
    for (const edge of systemEdges) {
      await expect(page.getByRole('heading', { name: edge.node.title })).not.toBeVisible()
    }

    // "No system activities" should NOT be visible since we're in Sales filter
    // But "No sales activities" should NOT be visible either (we have sales)
    const noSalesMsg = page.getByText(/no sales activities/i)
    const noSystemMsg = page.getByText(/no system activities/i)
    await expect(noSalesMsg).not.toBeVisible()
    await expect(noSystemMsg).not.toBeVisible()

    // --- Click "System" filter ---
    await page.getByRole('button', { name: /^system$/i }).click()
    await page.waitForTimeout(300)

    // System activities should be visible
    for (const edge of systemEdges) {
      await expect(page.getByRole('heading', { name: edge.node.title })).toBeVisible()
    }
    // Sales activities should be hidden
    for (const edge of salesEdges) {
      await expect(page.getByRole('heading', { name: edge.node.title })).not.toBeVisible()
    }

    // --- Click "All" filter again ---
    await page.getByRole('button', { name: /^all$/i }).click()
    await page.waitForTimeout(300)

    // All activities should be visible again
    for (const edge of mixedEdges) {
      await expect(page.getByRole('heading', { name: edge.node.title })).toBeVisible()
    }
  })

  // ====================================================================
  // Mobile responsive
  // ====================================================================
  test('[P2] E2E-16: Timeline renders correctly on mobile viewport', async ({ page }) => {
    test.skip(setupFailed, 'API not available')
    test.skip(!contactId, 'Contact ID not available')

    const edges = createMockEdges(4, contactId!)
    await mockTimeline(page, edges, false, null)

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    await page.goto(`/contacts/${contactId!}`)

    // Timeline section should be visible
    await expect(page.getByRole('heading', { name: /activity timeline/i })).toBeVisible({
      timeout: 20_000,
    })

    // Activity cards should render
    await expect(page.getByText(/by e2e tester/i).first()).toBeVisible({ timeout: 15_000 })

    // No horizontal overflow on mobile
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(hasOverflow).toBe(false)

    // Add Note button should be accessible
    const addNoteBtn = page.getByRole('button', { name: /add note/i })
    await expect(addNoteBtn).toBeVisible()
    await addNoteBtn.click()

    // Note composer textarea should be usable on mobile
    await expect(page.getByRole('textbox', { name: /note text/i })).toBeVisible()

    // Type and verify on mobile
    await page.getByRole('textbox', { name: /note text/i }).fill('Mobile note test')

    await expect(page.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })
})
