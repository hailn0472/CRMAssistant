import { expect, test, type BrowserContext } from '@playwright/test'
import { execFileSync } from 'child_process'
import path from 'path'
import { applyAuthCookie } from '../support/helpers/auth'

// =============================================================================
// Story 4.2: Automatic Activity Logging from Integrated Channels — E2E Spec
// =============================================================================
// Runs against the REAL dev stack (web :3000 + api :4000) with the seeded dev
// database. Covers the user-visible acceptance criteria:
//
//   Section H — Contact detail Activity tab (AC 45-49)
//     - The real ContactTimeline is mounted (the mock array and the literal
//       "Activity log is read-only in this view" string are gone — AC 49).
//     - Auto-logged activities (source != null) render a muted "Auto" badge
//       with title/aria-label "Automatically logged from <source>" — AC 48.
//     - New activity types TASK_COMPLETED / DEAL_STAGE_CHANGED /
//       MESSAGE_RECEIVED / MESSAGE_SENT render with their icons — AC 46.
//     - Manual notes (source == null) render WITHOUT the Auto badge — AC 3.
//     - Empty timeline state for a contact with no activities.
//
//   Section I — Settings preferences page (AC 50-54)
//     - Settings nav entry "Activity Logging" next to "Reminders", no roles /
//       no permission gating — AC 52.
//     - /settings/activity-logging loads the ActivityLogPreferencesForm with
//       five toggles (logTaskCompleted, logDealCreated, logDealStageChanged,
//       logMessageSent, logMessageReceived) — AC 50-51.
//     - Toggle off → save → react-hot-toast success with impact copy → reload
//       → persisted — AC 51 (TanStack Query load/mutate + invalidate).
//     - Breadcrumb label "Activity Logging" — AC 53.
//     - Preference off suppresses the producer (AC 22) — verified via API.
//
// Auth model (proven on 4-1 / 3-7): the browser sends a hand-signed JWT in
// the httpOnly `auth-token` cookie (middleware-verified, secret matches
// Infisical). Grants resolve server-side from DB role rows by userId; real
// user ids are resolved at setup via POST /auth/login (seed assigns random
// UUIDs — hardcoding them breaks on every fresh DB).
//
// Seed-data policy: activities are created through the REAL GraphQL producers
// (createTask + completeTask, createDeal + moveDealToStage, sendMessage) so
// the auto-logging hooks themselves are exercised. Two rows have no public
// mutation and are created via a one-shot Prisma write through `infisical
// run` (documented tech debt in crmassistant-operations): the Conversation
// (messages need an existing thread; no createConversation mutation exists)
// and the zero-activity contact (createContact always logs CONTACT_CREATED,
// so an empty timeline needs a DB-inserted row).
// =============================================================================

test.describe.configure({ retries: 1 })
test.use({ navigationTimeout: 60_000 })

const BACKEND_URL = 'http://127.0.0.1:4000/graphql'
const AUTH_LOGIN_URL = 'http://127.0.0.1:4000/auth/login'
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const DEMO_PASSWORD = 'Demo@123456'
const REPO_ROOT = process.cwd()

// Resolved at runtime from /auth/login (seed assigns random UUIDs).
let ADMIN_USER = ''
let SALES_USER = ''
let adminToken = ''
let salesToken = ''
let setupFailed = false
let setupError = ''

// Shared data created in beforeAll through the real API/DB.
let autoContactId = ''
let autoTaskTitle = ''
let autoDealTitle = ''
let leadStageName = ''
let qualifiedStageName = ''
let noteContactId = ''
let noteTitle = ''
let emptyContactId = ''
const AUTO_TOTAL = 6 // CONTACT_CREATED + TASK_COMPLETED + DEAL_CREATED + DEAL_STAGE_CHANGED + MESSAGE_SENT + MESSAGE_RECEIVED

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Real-user login with retry/backoff (Supabase Auth 500s under concurrent load). */
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
  process.env['JWT_SECRET'] = API_JWT_SECRET
  process.env['PLAYWRIGHT_USER_ID'] = userId
  process.env['PLAYWRIGHT_EMAIL'] = email
  await applyAuthCookie(context)
}

/**
 * One-shot Prisma write through `infisical run` — used only for rows that have
 * no public GraphQL mutation (Conversation, zero-activity Contact). Must run
 * with cwd = apps/api so @prisma/client resolves from the workspace.
 *
 * Retried with backoff: parallel workers each invoke this, and the Supabase
 * pooler transiently rejects connections under concurrent load (observed as
 * `infisical run ... exit status 1` with "failed to wait for command
 * termination" on 4-worker runs).
 */
function apiNodeWrite(script: string): string {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return execFileSync(
        'infisical',
        ['run', '--env=dev', '--path=/apps/api', '--', 'node', '-e', script],
        { cwd: path.join(REPO_ROOT, 'apps/api'), encoding: 'utf8', timeout: 120_000 },
      )
    } catch (err: unknown) {
      lastError = err
      if (attempt < 3) {
        // Synchronous backoff (500ms, 1s) — we are inside a sync helper.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * 2 ** (attempt - 1))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function createContactViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  firstName: string,
  lastName: string,
): Promise<{ id: string; email: string }> {
  const email = `e2e-4-2-${uniqueSuffix()}@test.local`
  const created = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation CreateContact($input: CreateContactInput!) {
        createContact(input: $input) {
          id
          firstName
          lastName
          email
        }
      }
    `,
    { input: { email, firstName, lastName } },
  )
  const contact = created.body?.data?.createContact
  if (!contact?.id) {
    throw new Error(`createContact failed: ${JSON.stringify(created.body)}`)
  }
  return { id: contact.id as string, email: contact.email as string }
}

async function createTaskViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  title: string,
  contactId: string,
): Promise<{ id: string }> {
  const created = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation CreateTask($input: CreateTaskInput!) {
        createTask(input: $input) {
          id
          title
          status
        }
      }
    `,
    { input: { title, contactId } },
  )
  const task = created.body?.data?.createTask
  if (!task?.id) {
    throw new Error(`createTask failed: ${JSON.stringify(created.body)}`)
  }
  return { id: task.id as string }
}

async function completeTaskViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  taskId: string,
): Promise<void> {
  const done = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation CompleteTask($id: ID!) {
        completeTask(id: $id) {
          id
          status
        }
      }
    `,
    { id: taskId },
  )
  if (done.body?.data?.completeTask?.status !== 'COMPLETED') {
    throw new Error(`completeTask failed: ${JSON.stringify(done.body)}`)
  }
}

async function createDealViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  title: string,
  contactId: string,
  stageId: string,
): Promise<{ id: string }> {
  const created = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation CreateDeal($input: CreateDealInput!) {
        createDeal(input: $input) {
          id
          title
        }
      }
    `,
    { input: { title, value: 1000, currency: 'USD', stageId, contactId } },
  )
  const deal = created.body?.data?.createDeal
  if (!deal?.id) {
    throw new Error(`createDeal failed: ${JSON.stringify(created.body)}`)
  }
  return { id: deal.id as string }
}

async function moveDealToStageViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  dealId: string,
  stageId: string,
): Promise<void> {
  const moved = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation MoveDealToStage($dealId: ID!, $stageId: ID!) {
        moveDealToStage(dealId: $dealId, stageId: $stageId) {
          id
        }
      }
    `,
    { dealId, stageId },
  )
  if (moved.body?.errors) {
    throw new Error(`moveDealToStage failed: ${JSON.stringify(moved.body)}`)
  }
}

async function sendMessageViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  conversationId: string,
  senderId: string,
  senderType: 'AGENT' | 'CONTACT',
  content: string,
): Promise<void> {
  const sent = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation SendMessage($input: SendMessageInput!) {
        sendMessage(input: $input) {
          id
        }
      }
    `,
    { input: { conversationId, senderId, senderType, content } },
  )
  if (sent.body?.errors) {
    throw new Error(`sendMessage failed: ${JSON.stringify(sent.body)}`)
  }
}

async function resetPrefs(
  request: import('@playwright/test').APIRequestContext,
  token: string,
): Promise<void> {
  const res = await apiGraphql(
    request,
    token,
    /* GraphQL */ `
      mutation UpdateActivityLogPreferences($input: UpdateActivityLogPreferenceInput!) {
        updateActivityLogPreferences(input: $input) {
          logTaskCompleted
          logDealCreated
          logDealStageChanged
          logMessageSent
          logMessageReceived
        }
      }
    `,
    {
      input: {
        logTaskCompleted: true,
        logDealCreated: true,
        logDealStageChanged: true,
        logMessageSent: true,
        logMessageReceived: true,
      },
    },
  )
  if (res.body?.errors) {
    throw new Error(`updateActivityLogPreferences failed: ${JSON.stringify(res.body)}`)
  }
}

/** Scopes locators to the mounted ContactTimeline root (h3 header's ancestor). */
function timelineScope(page: import('@playwright/test').Page): import('@playwright/test').Locator {
  return page.locator('h3', { hasText: 'Activity Timeline' }).locator('..').locator('..')
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test.describe('Automatic Activity Logging from Integrated Channels — Story 4.2', () => {
  test.beforeAll(async ({ request }) => {
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_TENANT_ID'] = TENANT_ID

    try {
      const admin = await apiLogin(request, 'admin@example.com')
      const sales = await apiLogin(request, 'sales@example.com')
      ADMIN_USER = admin.userId
      SALES_USER = sales.userId
      adminToken = admin.accessToken
      salesToken = sales.accessToken
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 4.2] Login unavailable for setup: ${msg}`)
      setupFailed = true
      setupError = `login: ${msg}`
    }

    if (setupFailed) return

    try {
      // Reset admin prefs first — a previous partial run may have left a
      // toggle off, which would silently suppress beforeAll's auto-logging.
      await resetPrefs(request, adminToken)

      // Resolve real pipeline stages for the DEAL_STAGE_CHANGED assertions.
      const stages = await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          query DealStages {
            dealStages {
              id
              name
            }
          }
        `,
      )
      const stageList = stages.body?.data?.dealStages as Array<{ id: string; name: string }>
      if (!stageList || stageList.length < 2) {
        throw new Error(`dealStages lookup failed: ${JSON.stringify(stages.body)}`)
      }
      leadStageName = stageList[0].name
      qualifiedStageName = stageList[1].name

      // ── Auto contact: one of every auto-logged activity type ────────────
      const autoContact = await createContactViaApi(request, adminToken, 'Auto', 'Last')
      autoContactId = autoContact.id

      const task = await createTaskViaApi(
        request,
        adminToken,
        `E2E 4-2 auto task ${uniqueSuffix()}`,
        autoContactId,
      )
      await completeTaskViaApi(request, adminToken, task.id)
      // Re-fetch the task title — the activity title is `Task completed: <title>`.
      const taskLookup = await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          query Task($id: ID!) {
            task(id: $id) {
              title
            }
          }
        `,
        { id: task.id },
      )
      autoTaskTitle = taskLookup.body?.data?.task?.title as string
      if (!autoTaskTitle) throw new Error(`task lookup failed: ${JSON.stringify(taskLookup.body)}`)

      const deal = await createDealViaApi(
        request,
        adminToken,
        `E2E 4-2 auto deal ${uniqueSuffix()}`,
        autoContactId,
        stageList[0].id,
      )
      autoDealTitle = `E2E 4-2 auto deal ${deal.id.slice(0, 4)}`
      const dealLookup = await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          query Deal($id: ID!) {
            deal(id: $id) {
              title
            }
          }
        `,
        { id: deal.id },
      )
      autoDealTitle = dealLookup.body?.data?.deal?.title as string
      if (!autoDealTitle) throw new Error(`deal lookup failed: ${JSON.stringify(dealLookup.body)}`)
      await moveDealToStageViaApi(request, adminToken, deal.id, stageList[1].id)

      // ── DB-only rows (no public mutation exists): the Conversation for
      //    the message flows, and the zero-activity contact for the empty
      //    state (createContact always auto-logs CONTACT_CREATED). Both are
      //    created in ONE infisical run to halve pooler pressure. ────────
      const emptyEmail = `e2e-4-2-empty-${uniqueSuffix()}@test.local`
      const dbScript = `
        const { PrismaClient } = require('@prisma/client');
        const p = new PrismaClient();
        (async () => {
          const conv = await p.conversation.create({
            data: {
              tenantId: '${TENANT_ID}',
              contactId: '${autoContactId}',
              channel: 'INTERNAL',
              status: 'OPEN',
              createdBy: 'e2e-4-2',
              updatedBy: 'e2e-4-2',
            },
          });
          console.log('CONV:' + conv.id);
          const contact = await p.contact.create({
            data: {
              tenantId: '${TENANT_ID}',
              email: '${emptyEmail}',
              firstName: 'Empty',
              lastName: 'State',
              ownerId: '${ADMIN_USER}',
              createdBy: 'e2e-4-2',
              updatedBy: 'e2e-4-2',
            },
          });
          console.log('CONTACT:' + contact.id);
          await p.$disconnect();
        })().catch((e) => { console.error('ERR', e.message); process.exit(1); });
      `
      const dbOut = apiNodeWrite(dbScript)
      const convLine = dbOut.split('\n').find((l) => l.startsWith('CONV:'))
      if (!convLine) throw new Error(`conversation create failed: ${dbOut.slice(-300)}`)
      const conversationId = convLine.slice(5)
      const emptyLine = dbOut.split('\n').find((l) => l.startsWith('CONTACT:'))
      if (!emptyLine) throw new Error(`empty contact create failed: ${dbOut.slice(-300)}`)
      emptyContactId = emptyLine.slice(8)

      await sendMessageViaApi(
        request,
        adminToken,
        conversationId,
        ADMIN_USER,
        'AGENT',
        `E2E 4-2 agent message ${uniqueSuffix()}`,
      )
      await sendMessageViaApi(
        request,
        adminToken,
        conversationId,
        'e2e-contact-sender',
        'CONTACT',
        `E2E 4-2 customer message ${uniqueSuffix()}`,
      )

      // ── Note contact: one manual note (source == null → no Auto badge) ──
      const noteContact = await createContactViaApi(request, adminToken, 'Note', 'Taker')
      noteContactId = noteContact.id
      noteTitle = `E2E 4-2 manual note ${uniqueSuffix()}`
      const noteRes = await apiGraphql(
        request,
        adminToken,
        /* GraphQL */ `
          mutation AddContactNote($contactId: ID!, $title: String!, $description: String) {
            addContactNote(contactId: $contactId, title: $title, description: $description) {
              id
              type
              title
              source
            }
          }
        `,
        {
          contactId: noteContactId,
          title: noteTitle,
          description: 'A manual note written by the E2E suite.',
        },
      )
      if (noteRes.body?.errors) {
        throw new Error(`addContactNote failed: ${JSON.stringify(noteRes.body)}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 4.2] Setup failed: ${msg}`)
      setupFailed = true
      setupError = msg
    }
  })

  test.afterEach(() => {
    delete process.env['JWT_SECRET']
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
  })

  // =====================================================================
  // Section I — Settings preferences page (AC 50-54)
  // =====================================================================
  test('[P1] E2E-AL-01: Settings nav shows "Activity Logging" next to "Reminders" (AC 52)', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, ADMIN_USER, 'admin@example.com')

    await page.goto('/settings/reminders')
    const nav = page.getByRole('navigation', { name: 'Settings navigation' })
    // Generous timeout: the first navigation after a cold `pnpm dev` boot
    // pays Next.js's on-demand route compile (observed >30s once).
    await expect(nav).toBeVisible({ timeout: 60_000 })

    const loggingLink = nav.getByRole('link', { name: 'Activity Logging', exact: true })
    await expect(loggingLink).toBeVisible()
    await expect(loggingLink).toHaveAttribute('href', '/settings/activity-logging')
    // "next to Reminders" — the Reminders entry is present in the same nav.
    const remindersLink = nav.getByRole('link', { name: 'Reminders', exact: true })
    await expect(remindersLink).toBeVisible()
    await expect(remindersLink).toHaveAttribute('href', '/settings/reminders')
  })

  test('[P1] E2E-AL-02: Sales rep also sees the entry (no roles, no permission — AC 52)', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, SALES_USER, 'sales@example.com')

    await page.goto('/settings')
    const nav = page.getByRole('navigation', { name: 'Settings navigation' })
    await expect(nav.getByRole('link', { name: 'Activity Logging', exact: true })).toBeVisible({
      timeout: 60_000,
    })
    await expect(nav.getByRole('link', { name: 'Reminders', exact: true })).toBeVisible()
  })

  test('[P1] E2E-AL-03: Page loads with heading, breadcrumb and five toggles (AC 50, 51, 53)', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    // Uses the ADMIN user on purpose: admin prefs are only reset to all-true
    // in beforeAll and never mutated at runtime (the toggle test E2E-AL-04
    // mutates SALES prefs), so this load-state test cannot race a parallel
    // toggle test.
    await authAs(context, ADMIN_USER, 'admin@example.com')

    await page.goto('/settings/activity-logging')
    await expect(page.getByRole('heading', { name: 'Activity Logging', level: 1 })).toBeVisible({
      timeout: 30_000,
    })
    // AC 53 — breadcrumb label (no more "Chi tiết" fallback).
    await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(
      'Activity Logging',
      { timeout: 10_000 },
    )
    // Form CardTitle (CardTitle renders a <div>, not a heading role).
    await expect(
      page.getByText('Activity Logging Preferences', { exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 })

    // AC 51 — five switches, each with a descriptive label, all default ON.
    const switches = [
      ['Log task completions', 'Task completed'],
      ['Log deal creation', 'Deal created'],
      ['Log deal stage changes', 'Deal stage changed'],
      ['Log sent messages', 'Message sent'],
      ['Log received messages', 'Message received'],
    ] as const
    for (const [ariaLabel, labelText] of switches) {
      const toggle = page.getByRole('switch', { name: ariaLabel })
      await expect(toggle).toBeVisible()
      await expect(toggle).toBeChecked()
      await expect(page.getByText(labelText, { exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Save preferences', exact: true })).toBeVisible()
  })

  test('[P1] E2E-AL-04: Toggle off logTaskCompleted persists and suppresses TASK_COMPLETED logging (AC 51, 22)', async ({
    page,
    context,
    request,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, SALES_USER, 'sales@example.com')

    // Deterministic start: all five rules on.
    await resetPrefs(request, salesToken)

    await page.goto('/settings/activity-logging')
    const taskToggle = page.getByRole('switch', { name: 'Log task completions' })
    await expect(taskToggle).toBeChecked({ timeout: 30_000 })

    // Toggle OFF → Save.
    await taskToggle.click()
    await expect(taskToggle).not.toBeChecked()
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click()

    // Success toast carries impact copy (AC 51), not just "Saved".
    await expect(
      page.getByText(
        '1 of 5 logging rules turned off — those events will no longer appear on contact timelines.',
      ),
    ).toBeVisible({ timeout: 15_000 })

    // Reload → the choice persisted (TanStack Query refetch from the API).
    await page.reload()
    const taskToggleAfter = page.getByRole('switch', { name: 'Log task completions' })
    await expect(taskToggleAfter).not.toBeChecked({ timeout: 30_000 })
    await expect(page.getByRole('switch', { name: 'Log deal creation' })).toBeChecked()
    await expect(page.getByRole('switch', { name: 'Log deal stage changes' })).toBeChecked()
    await expect(page.getByRole('switch', { name: 'Log sent messages' })).toBeChecked()
    await expect(page.getByRole('switch', { name: 'Log received messages' })).toBeChecked()

    // AC 22 — with logTaskCompleted off, the TASK_COMPLETED producer is
    // suppressed: completing a task as sales logs no TASK_COMPLETED activity.
    const contact = await createContactViaApi(request, salesToken, 'Suppressed', 'Flow')
    const task = await createTaskViaApi(
      request,
      salesToken,
      `E2E 4-2 suppressed ${uniqueSuffix()}`,
      contact.id,
    )
    await completeTaskViaApi(request, salesToken, task.id)

    const tl = await apiGraphql(
      request,
      salesToken,
      /* GraphQL */ `
        query Timeline($contactId: ID!, $first: Int) {
          contactTimeline(contactId: $contactId, first: $first) {
            edges {
              node {
                type
              }
            }
          }
        }
      `,
      { contactId: contact.id, first: 20 },
    )
    const types = (tl.body?.data?.contactTimeline?.edges ?? []).map(
      (e: { node: { type: string } }) => e.node.type,
    ) as string[]
    expect(types).toContain('CONTACT_CREATED') // sanity: the timeline query works
    expect(types).not.toContain('TASK_COMPLETED') // suppressed by the preference

    // Restore the shared dev DB to a clean state for reruns.
    await resetPrefs(request, salesToken)
  })

  // =====================================================================
  // Section H — Contact detail Activity tab (AC 45-49)
  // =====================================================================
  test('[P1] E2E-AL-05: Activity tab renders the real timeline with all auto-logged types (AC 45, 49)', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, ADMIN_USER, 'admin@example.com')

    await page.goto(`/contacts/${autoContactId}`)
    await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('tab', { name: 'Activity', exact: true }).click()

    // Real ContactTimeline mounted (AC 49): header with live totalCount.
    await expect(page.getByText(`(${AUTO_TOTAL} activities)`).first()).toBeVisible({
      timeout: 30_000,
    })
    const scope = timelineScope(page)
    await expect(scope.getByText('Activity Timeline').first()).toBeVisible()

    // Titles prove each producer ran with its 4.2 copy (AC 45 labels):
    await expect(scope.getByText(`Task completed: ${autoTaskTitle}`).first()).toBeVisible()
    await expect(scope.getByText(`Deal created: ${autoDealTitle}`).first()).toBeVisible()
    await expect(scope.getByText(`Deal moved to ${qualifiedStageName}`).first()).toBeVisible()
    await expect(scope.getByText(`${leadStageName} → ${qualifiedStageName}`).first()).toBeVisible()
    await expect(scope.getByText('Message sent to Auto Last').first()).toBeVisible()
    await expect(scope.getByText('Message received from Auto Last').first()).toBeVisible()

    // Infinite-scroll end marker proves pagination is real, not a mock array.
    await expect(scope.getByText('No more activities').first()).toBeVisible()
  })

  test('[P1] E2E-AL-06: Auto badge renders muted with aria-label per source (AC 48)', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, ADMIN_USER, 'admin@example.com')

    await page.goto(`/contacts/${autoContactId}`)
    await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('tab', { name: 'Activity', exact: true }).click()

    // TASK source — exactly one TASK_COMPLETED activity.
    const taskBadge = page.getByLabel('Automatically logged from TASK')
    await expect(taskBadge).toBeVisible({ timeout: 30_000 })
    await expect(taskBadge).toHaveText('Auto', { timeout: 10_000 })
    // Muted colour paired with text (WCAG AA — never colour alone, AC 48).
    await expect(taskBadge).toHaveClass(/bg-slate-100/)
    await expect(taskBadge).toHaveClass(/text-slate-500/)

    // DEAL source — DEAL_CREATED + DEAL_STAGE_CHANGED.
    await expect(page.getByLabel('Automatically logged from DEAL')).toHaveCount(2)

    // MESSAGE source — MESSAGE_SENT + MESSAGE_RECEIVED.
    await expect(page.getByLabel('Automatically logged from MESSAGE')).toHaveCount(2)
  })

  test('[P1] E2E-AL-07: New activity types render their icons (AC 46)', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, ADMIN_USER, 'admin@example.com')

    await page.goto(`/contacts/${autoContactId}`)
    await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('tab', { name: 'Activity', exact: true }).click()
    const scope = timelineScope(page)
    await expect(scope.getByText('Activity Timeline').first()).toBeVisible({ timeout: 30_000 })

    // Icon colour vocabulary from ICON_CONFIGS (AC 46): TASK_COMPLETED →
    // emerald CheckCircle2, deal icons → orange, message icons → sky.
    await expect(scope.locator('svg.text-emerald-600').first()).toBeVisible()
    await expect(scope.locator('svg.text-orange-600').first()).toBeVisible()
    await expect(scope.locator('svg.text-sky-600').first()).toBeVisible()
  })

  test('[P1] E2E-AL-08: The mock "read-only" string is gone from the Activity tab (AC 49)', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, ADMIN_USER, 'admin@example.com')

    await page.goto(`/contacts/${autoContactId}`)
    await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('tab', { name: 'Activity', exact: true }).click()

    await expect(page.getByText('Activity log is read-only in this view')).toHaveCount(0, {
      timeout: 10_000,
    })
    // The real header is present instead.
    await expect(page.getByText('Activity Timeline').first()).toBeVisible({ timeout: 30_000 })
  })

  test('[P1] E2E-AL-09: Manual note renders without the Auto badge (source null — AC 3)', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, ADMIN_USER, 'admin@example.com')

    await page.goto(`/contacts/${noteContactId}`)
    await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('tab', { name: 'Activity', exact: true }).click()

    const noteCard = page.locator('div.rounded-lg.border', { hasText: noteTitle }).first()
    await expect(noteCard).toBeVisible({ timeout: 30_000 })
    // A manual note is never auto-logged: no "Auto" badge inside its card,
    // and no "Automatically logged from …" label anywhere on the timeline.
    await expect(noteCard.getByText('Auto', { exact: true })).toHaveCount(0)
    const scope = timelineScope(page)
    await expect(scope.getByLabel(/Automatically logged from/)).toHaveCount(0)
  })

  test('[P1] E2E-AL-10: Empty timeline state for a contact with no activities', async ({
    page,
    context,
  }) => {
    test.skip(setupFailed, setupError || 'API unavailable — setup failed')
    await authAs(context, ADMIN_USER, 'admin@example.com')

    await page.goto(`/contacts/${emptyContactId}`)
    await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('tab', { name: 'Activity', exact: true }).click()

    await expect(
      page.getByText('No activity recorded yet — log your first interaction'),
    ).toBeVisible({ timeout: 30_000 })
    // The empty-state header + Add Note affordance still render.
    await expect(page.getByText('Activity Timeline').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add Note', exact: true })).toBeVisible()
  })
})
