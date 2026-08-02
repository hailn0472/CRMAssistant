import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { applyAuthCookie } from '../support/helpers/auth'

// =============================================================================
// Story 3-7: Automated Deal Reminders & Health Alerts — E2E Spec
// =============================================================================
// Runs against the REAL dev stack (web :3000 + api :4000) with the seeded dev
// database. Covers AC 65: the dashboard at-risk widget, the deal-detail health
// badge, and the snooze round-trip.
//
// Prerequisites (see pipeline runbook):
//   - `pnpm dev` running (web + api), DB seeded (`pnpm prisma:seed`).
//
// Auth model: the browser sends a hand-signed JWT in the httpOnly `auth-token`
// cookie (middleware-verified). Permission grants are resolved server-side from
// the DB. User ids are resolved at setup via POST /auth/login (the seed assigns
// random UUIDs, so hardcoding them breaks on every fresh DB). The deal owner is
// the SALES user because SALES_REP has dataVisibility OWN — a deal owned by the
// admin would be invisible to the sales rep.
//
// At-risk seeding: the dev seed has no Deal rows, and a fresh deal's updatedAt
// is "now" (HEALTHY). We create a deal with expectedCloseDate in the past —
// PAST_CLOSE_DATE (-40) makes it AT_RISK with no DB backdating required.
// =============================================================================

test.describe.configure({ retries: 1 })

const BACKEND_URL = 'http://127.0.0.1:4000/graphql'
const AUTH_LOGIN_URL = 'http://127.0.0.1:4000/auth/login'
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const DEMO_PASSWORD = 'Demo@123456'
// Resolved at runtime from /auth/login — prisma/seed.ts upserts users without
// a fixed id, so the dev DB gets random UUIDs and hardcoded ids go stale the
// moment the database is re-seeded (E2E-37 fix 2026-08-02).
let ADMIN_USER = ''
let SALES_USER = ''

/** Real-user login: returns the server-issued JWT and the user's DB id.
 *  Supabase Auth can transiently 500 / time out under concurrent load, so
 *  retry with backoff before giving up on setup. */
async function apiLogin(
  client: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<{ userId: string; accessToken: string }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await client.post(AUTH_LOGIN_URL, {
        headers: { 'Content-Type': 'application/json' },
        data: { email, password: DEMO_PASSWORD },
      })
      const body = await res.json()
      if (res.ok() && body?.userId && body?.accessToken) {
        return { userId: body.userId as string, accessToken: body.accessToken as string }
      }
      lastError = new Error(`login failed for ${email}: ${res.status()} ${JSON.stringify(body)}`)
    } catch (err: unknown) {
      lastError = err
    }
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function apiGraphql(
  client: import('@playwright/test').APIRequestContext,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await client.post(BACKEND_URL, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    data: { query, variables },
  })
  return { status: res.status(), body: await res.json() }
}

async function authAs(context: BrowserContext, userId: string, email: string): Promise<void> {
  process.env['PLAYWRIGHT_USER_ID'] = userId
  process.env['PLAYWRIGHT_EMAIL'] = email
  await applyAuthCookie(context)
}

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------
let adminToken: string
let stageId = ''
let contactId = ''
let setupFailed = false
/** Fresh at-risk deal per test (owned by SALES_USER, past expectedCloseDate). */
let dealId = ''

test.describe('Story 3-7 Automated Deal Reminders & Health Alerts — E2E', () => {
  test.beforeAll(async ({ request }) => {
    // The whole file runs in one worker (default), so mutating process.env is safe.
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_TENANT_ID'] = TENANT_ID

    try {
      const admin = await apiLogin(request, 'admin@example.com')
      const sales = await apiLogin(request, 'sales@example.com')
      ADMIN_USER = admin.userId
      SALES_USER = sales.userId
      adminToken = admin.accessToken
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 3-7] Login unavailable for setup: ${msg}`)
      setupFailed = true
    }

    if (setupFailed) return

    try {
      const lookup = await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          query SetupLookup {
            dealStages {
              id
              name
            }
            contacts(pagination: { page: 1, pageSize: 1 }) {
              items {
                id
                email
              }
            }
          }
        `,
      )
      stageId = lookup.body?.data?.dealStages?.[0]?.id ?? ''
      contactId = lookup.body?.data?.contacts?.items?.[0]?.id ?? ''
      if (!stageId || !contactId) {
        console.warn('[E2E 3-7] No stage/contact available:', JSON.stringify(lookup.body))
        setupFailed = true
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 3-7] API unavailable for setup: ${msg}`)
      setupFailed = true
    }
  })

  /** Creates a fresh at-risk deal owned by the SALES user: expectedCloseDate in
   *  the past makes it AT_RISK (PAST_CLOSE_DATE) without DB backdating. */
  async function createFreshAtRiskDeal(
    request: import('@playwright/test').APIRequestContext,
  ): Promise<string> {
    const title = `E2E 3-7 ${Date.now().toString(36)}`
    const created = await apiGraphql(
      request,
      adminToken,
      /* GraphQL */ `
        mutation CreateDeal($input: CreateDealInput!) {
          createDeal(input: $input) {
            id
            title
          }
        }
      `,
      {
        input: {
          title,
          value: 24500,
          currency: 'USD',
          stageId,
          contactId,
          ownerId: SALES_USER,
          expectedCloseDate: '2020-01-01T00:00:00.000Z',
        },
      },
    )
    const id = created.body?.data?.createDeal?.id ?? ''
    if (!id) throw new Error(`createDeal failed: ${JSON.stringify(created.body)}`)
    return id
  }

  test.beforeEach(async ({ request, context }) => {
    await authAs(context, ADMIN_USER, 'admin@example.com')
    if (!setupFailed) {
      dealId = await createFreshAtRiskDeal(request)
    }
  })

  test.afterEach(() => {
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
  })

  // =====================================================================
  // AC 51 — Dashboard at-risk widget renders live data
  // =====================================================================
  test('[P1] E2E-37-01: Command Center shows the at-risk deals widget with the fresh deal', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await authAs(page.context(), SALES_USER, 'sales@example.com')
    await page.goto('/dashboard')

    const widget = page.getByText('At-risk deals', { exact: true })
    await expect(widget).toBeVisible({ timeout: 30_000 })

    // The fresh deal appears with title, owner, health badge and reason text.
    const row = page.locator('a[href^="/deals/"]', { hasText: 'E2E 3-7' }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText('At risk')
    await expect(row).toContainText('Close date is past due')
  })

  // =====================================================================
  // AC 48 / AC 49 — Deal detail health badge + reason line
  // =====================================================================
  test('[P1] E2E-37-02: Deal detail renders the health badge with a text label and reason line', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await authAs(page.context(), SALES_USER, 'sales@example.com')
    await page.goto(`/deals/${dealId}`)

    const badge = page.locator('div', { hasText: /^At risk$/ }).first()
    await expect(badge).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Close date is past due')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Snooze reminders' })).toBeVisible()
  })

  // =====================================================================
  // AC 38 / AC 49 — Snooze round-trip on the deal detail page
  // =====================================================================
  test('[P1] E2E-37-03: Snooze round-trip — dialog, active state, unsnooze', async ({ page }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await authAs(page.context(), SALES_USER, 'sales@example.com')
    await page.goto(`/deals/${dealId}`)

    const snoozeButton = page.getByRole('button', { name: 'Snooze reminders' })
    await expect(snoozeButton).toBeVisible({ timeout: 30_000 })
    await snoozeButton.click()

    // Dialog offers exactly 7 / 14 / 30 days.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio', { name: '7 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(dialog.getByRole('radio', { name: '14 days' })).toBeVisible()
    await expect(dialog.getByRole('radio', { name: '30 days' })).toBeVisible()

    // Select 14 days and confirm.
    await dialog.getByRole('radio', { name: '14 days' }).click()
    await dialog.getByRole('button', { name: /Snooze for 14 days/ }).click()

    // Active snooze state replaces the button.
    await expect(page.getByText(/Reminders snoozed until/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Unsnooze' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Snooze reminders' })).toHaveCount(0)

    // Unsnooze brings the button back.
    await page.getByRole('button', { name: 'Unsnooze' }).click()
    await expect(page.getByRole('button', { name: 'Snooze reminders' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(/Reminders snoozed until/)).toHaveCount(0)
  })
})
