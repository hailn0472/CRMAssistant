import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { applyAuthCookie } from '../support/helpers/auth'

// =============================================================================
// Story 3-6: Deal Document Attachment & Collaboration — E2E Spec
// =============================================================================
// Runs against the REAL dev stack (web :3000 + api :4000) with the seeded dev
// database. All frontend ACs (#37-#47) get at least one test case.
//
// Prerequisites (see pipeline runbook):
//   - `pnpm dev` running (web + api), DB seeded (`pnpm prisma:seed`),
//   - Supabase private bucket `deal-documents` exists (created via the Storage
//     API; upload 500s with "Document storage is unavailable" until it does),
//   - a DEAL:READ-only viewer user `11111111-1111-4111-8111-111111111111`
//     (role E2E_VIEWER, dataVisibility ALL) exists in the Acme tenant.
//
// Auth model: the browser sends a hand-signed JWT in the httpOnly `auth-token`
// cookie (middleware-verified). Permission *grants* are resolved server-side
// from the DB, so the JWT only needs to identify an existing user in the
// tenant. The dev DB's ADMIN role row carries every permission, so the admin
// user passes all gates regardless of the JWT role claim. The deal owner is
// the SALES user because SALES_REP has dataVisibility OWN — a deal owned by
// the admin would be invisible to the sales rep.
//
// FIXED 2026-08-01 (E2E-36-21): DealDocumentUpload now invalidates
// ['dealDocuments', dealId] after a successful upload, so the list refreshes
// without a manual reload — upload tests assert the row directly.
// =============================================================================

test.describe.configure({ retries: 1 })

// ---------------------------------------------------------------------------
// Constants (match seeded dev data)
// ---------------------------------------------------------------------------
const BACKEND_URL = 'http://127.0.0.1:4000/graphql'
const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const ADMIN_USER = '1d10f592-95d6-4a26-8a81-9cf69a1bafc0' // admin@example.com (ADMIN)
const SALES_USER = '3840d19a-6817-4ca0-89a6-8c8277e965d6' // sales@example.com (SALES_REP)
const VIEWER_USER = '11111111-1111-4111-8111-111111111111' // viewer@example.com (E2E_VIEWER, DEAL:READ only)

const PDF_MAGIC = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'

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

/** Authenticate the given context as a specific seeded user (via cookie JWT). */
async function authAs(context: BrowserContext, userId: string, email: string): Promise<void> {
  process.env['PLAYWRIGHT_USER_ID'] = userId
  process.env['PLAYWRIGHT_EMAIL'] = email
  await applyAuthCookie(context)
}

/** The error panel is the drop zone's `<p role="alert">` — Next.js also ships a
 *  route-announcer with role=alert, so scope by tag + text. */
function dropZoneAlert(page: Page) {
  return page.locator('p[role="alert"]')
}

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------
let adminToken: string
let stageId = ''
let contactId = ''
let setupFailed = false
/** Fresh deal per test (owned by SALES_USER) with one sales-authored comment. */
let dealId = ''

test.describe('Story 3-6 Deal Document Attachment & Collaboration — E2E', () => {
  test.beforeAll(async ({ request }) => {
    // The whole file runs in one worker (default), so mutating process.env is safe.
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_TENANT_ID'] = TENANT_ID
    adminToken = buildApiJwt(API_JWT_SECRET, ADMIN_USER, TENANT_ID, ['ADMIN'])

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
        console.warn('[E2E 3-6] No stage/contact available:', JSON.stringify(lookup.body))
        setupFailed = true
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[E2E 3-6] API unavailable for setup: ${msg}`)
      setupFailed = true
    }
  })

  /** Creates a fresh deal owned by the SALES user (so SALES_REP's OWN
   *  visibility allows the sales rep to comment on it), then seeds one
   *  sales-authored comment for thread/ownership tests. */
  async function createFreshDeal(
    request: import('@playwright/test').APIRequestContext,
  ): Promise<string> {
    const title = `E2E 3-6 ${Date.now().toString(36)}`
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
          value: 75000,
          currency: 'USD',
          stageId,
          contactId,
          ownerId: SALES_USER,
        },
      },
    )
    const id = created.body?.data?.createDeal?.id ?? ''
    if (!id) throw new Error(`createDeal failed: ${JSON.stringify(created.body)}`)

    const salesToken = buildApiJwt(API_JWT_SECRET, SALES_USER, TENANT_ID, ['SALES_REP'])
    await apiGraphql(
      request,
      salesToken,
      /* GraphQL */ `
        mutation AddDealComment($input: AddDealCommentInput!) {
          addDealComment(input: $input) {
            id
          }
        }
      `,
      { input: { dealId: id, comment: 'Pre-sales note from Sales Rep' } },
    )
    return id
  }

  test.beforeEach(async ({ request, context }) => {
    await authAs(context, ADMIN_USER, 'admin@example.com')
    if (!setupFailed) {
      dealId = await createFreshDeal(request)
    }
  })

  test.afterEach(() => {
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
  })

  // =====================================================================
  // AC 37 / AC 38 — Collaboration block with a hand-rolled accessible tablist
  // =====================================================================
  test('[P1] E2E-36-01: Deal detail renders the Collaboration block with Documents/Comments tabs', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)

    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })

    const documentsTab = page.getByRole('tab', { name: 'Documents' })
    const commentsTab = page.getByRole('tab', { name: 'Comments' })
    await expect(documentsTab).toBeVisible()
    await expect(commentsTab).toBeVisible()

    // Documents is the active tab by default; only it is in the tab order.
    await expect(documentsTab).toHaveAttribute('aria-selected', 'true')
    await expect(commentsTab).toHaveAttribute('aria-selected', 'false')
    await expect(documentsTab).toHaveAttribute('tabindex', '0')
    await expect(commentsTab).toHaveAttribute('tabindex', '-1')
    await expect(documentsTab).toHaveAttribute('aria-controls', 'deal-collab-panel-documents')
    await expect(commentsTab).toHaveAttribute('aria-controls', 'deal-collab-panel-comments')

    // Panels are labelled by their triggers; the inactive one is hidden.
    const docsPanel = page.getByRole('tabpanel', { name: 'Documents' })
    const commentsPanel = page.getByRole('tabpanel', { name: 'Comments' })
    await expect(docsPanel).toBeVisible()
    await expect(commentsPanel).toBeHidden()
  })

  test('[P1] E2E-36-02: Tab switcher supports Left/Right arrow keys and keeps one trigger in tab order', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })

    const documentsTab = page.getByRole('tab', { name: 'Documents' })
    const commentsTab = page.getByRole('tab', { name: 'Comments' })

    await documentsTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(commentsTab).toHaveAttribute('aria-selected', 'true')
    await expect(commentsTab).toHaveAttribute('tabindex', '0')
    await expect(documentsTab).toHaveAttribute('tabindex', '-1')
    await expect(commentsTab).toBeFocused()
    await expect(page.getByRole('tabpanel', { name: 'Comments' })).toBeVisible()

    await page.keyboard.press('ArrowLeft')
    await expect(documentsTab).toHaveAttribute('aria-selected', 'true')
    await expect(documentsTab).toBeFocused()
    await expect(page.getByRole('tabpanel', { name: 'Documents' })).toBeVisible()

    // Clicking also switches, and the comments panel mounts the thread.
    await commentsTab.click()
    await expect(commentsTab).toHaveAttribute('aria-selected', 'true')
  })

  // =====================================================================
  // AC 39 / AC 40 — Documents list + upload drop zone / Choose file
  // =====================================================================
  test('[P1] E2E-36-03: Documents tab lists table columns and empty state for a fresh deal', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByRole('tablist', { name: 'Deal collaboration' })).toBeVisible({
      timeout: 30_000,
    })

    // Empty state on a fresh deal.
    await expect(page.getByText('No documents yet')).toBeVisible()
    // Header idiom from DealLineItems (AC 39).
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible()

    // Upload affordances render for a DEAL:UPDATE user (AC 47).
    await expect(page.getByRole('button', { name: 'Attach a document' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose file', exact: true })).toBeVisible()
  })

  test('[P1] E2E-36-04: Upload via "Choose file" button — document row renders with all fields', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByRole('tablist', { name: 'Deal collaboration' })).toBeVisible({
      timeout: 30_000,
    })

    const fileName = `contract-${Date.now().toString(36)}.pdf`
    const uploadResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/deals/${dealId}/documents`) && res.request().method() === 'POST',
      { timeout: 30_000 },
    )

    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from(PDF_MAGIC, 'utf-8'),
    })

    // The Next.js proxy forwards to the Nest REST controller -> 201 (AC 41).
    const response = await uploadResponse
    expect(response.status()).toBe(201)

    // Success toast is concrete: "<file> attached" (AC 46).
    await expect(page.getByText(`${fileName} attached`)).toBeVisible({ timeout: 15_000 })

    // The list invalidates on upload (E2E-36-21 fix) — the row appears
    // without a reload (AC 39).

    // Row renders the fields (AC 39): file name, type label, size, uploader, date.
    const row = page.getByRole('row').filter({ hasText: fileName })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByRole('cell', { name: fileName, exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'PDF', exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'Acme Admin', exact: true })).toBeVisible()
    // ~50-byte fixture formats as "46 B" — assert a non-empty size cell.
    await expect(row.getByRole('cell').nth(2)).not.toBeEmpty()
    await expect(row.getByRole('cell').nth(4)).not.toBeEmpty()

    // The visible "Choose file" button is wired to the hidden input: click it
    // and the file chooser opens (AC 40 non-drag alternative).
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Choose file', exact: true }).click(),
    ])
    expect(chooser.isMultiple()).toBe(false)
  })

  test('[P1] E2E-36-05: Upload via drag-and-drop on the drop zone', async ({ page }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const zone = page.getByRole('button', { name: 'Attach a document' })
    await expect(zone).toBeVisible({ timeout: 30_000 })

    const fileName = `dropped-${Date.now().toString(36)}.pdf`
    const dataTransfer = await page.evaluateHandle(
      ([name]) => {
        const dt = new DataTransfer()
        dt.items.add(
          new File(['%PDF-1.4\nDropped via drag and drop\n%%EOF'], name, {
            type: 'application/pdf',
          }),
        )
        return dt
      },
      [fileName],
    )
    await zone.dispatchEvent('drop', { dataTransfer })

    await expect(page.getByText(`${fileName} attached`)).toBeVisible({ timeout: 15_000 })
    // List invalidates on upload (E2E-36-21 fix) — no reload needed.
    const row = page.getByRole('row').filter({ hasText: fileName })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByRole('cell', { name: 'PDF', exact: true })).toBeVisible()
  })

  test('[P1] E2E-36-06: Client-side rejection — wrong extension shows role=alert with allowlist copy', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByRole('button', { name: 'Attach a document' })).toBeVisible({
      timeout: 30_000,
    })

    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('plain text', 'utf-8'),
    })

    const alert = dropZoneAlert(page)
    await expect(alert).toBeVisible({ timeout: 10_000 })
    await expect(alert).toHaveText(
      'Unsupported file type ".txt". Allowed: PDF, DOCX, XLSX, PNG, JPG',
    )
    // No upload was attempted — no toast, no row.
    await expect(page.getByText('No documents yet')).toBeVisible()
  })

  test('[P1] E2E-36-07: Client-side rejection — oversized file (>10MB) shows the 10MB-limit copy', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByRole('button', { name: 'Attach a document' })).toBeVisible({
      timeout: 30_000,
    })

    await page.locator('input[type="file"]').setInputFiles({
      name: 'huge.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25), // %PDF bytes, over 10MB
    })

    const alert = dropZoneAlert(page)
    await expect(alert).toBeVisible({ timeout: 10_000 })
    await expect(alert).toHaveText(
      'This file is larger than the 10MB limit. Choose a smaller file.',
    )
  })

  test('[P1] E2E-36-08: Server-side magic-byte rejection — renamed non-PDF .pdf surfaces the upstream 400 in role=alert', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByRole('button', { name: 'Attach a document' })).toBeVisible({
      timeout: 30_000,
    })

    // Extension is allowed client-side, but the bytes are not a PDF -> the
    // server's detectDocumentType rejects it and the 400 must reach the
    // browser unchanged through the proxy (AC 15/41/46).
    const uploadResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/deals/${dealId}/documents`) && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.locator('input[type="file"]').setInputFiles({
      name: 'fake.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('this is definitely not a pdf file', 'utf-8'),
    })

    const response = await uploadResponse
    expect(response.status()).toBe(400)

    const alert = dropZoneAlert(page)
    await expect(alert).toBeVisible({ timeout: 10_000 })
    await expect(alert).toContainText('Unsupported file type. Allowed: PDF, DOCX, XLSX, PNG, JPG')
    await expect(page.getByText('No documents yet')).toBeVisible()
  })

  test('[P1] E2E-36-09: Download click mints a fresh signed URL (never a stored href)', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByRole('button', { name: 'Attach a document' })).toBeVisible({
      timeout: 30_000,
    })

    const fileName = `download-me-${Date.now().toString(36)}.pdf`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from(PDF_MAGIC, 'utf-8'),
    })
    await expect(page.getByText(`${fileName} attached`)).toBeVisible({ timeout: 15_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })

    const row = page.getByRole('row').filter({ hasText: fileName })
    await expect(row).toBeVisible({ timeout: 15_000 })

    const downloadQuery = page.waitForResponse(
      (res) =>
        res.url().includes('/graphql') &&
        (res.request().postData()?.includes('dealDocumentDownloadUrl') ?? false),
      { timeout: 15_000 },
    )
    await row.getByRole('button', { name: fileName, exact: true }).click()
    const dlRes = await downloadQuery
    const dlBody = (await dlRes.json()) as any
    const url: string = dlBody?.data?.dealDocumentDownloadUrl ?? ''
    expect(url).toMatch(/^https:\/\/.+\/storage\/v1\/object\/sign\/deal-documents\//)
    expect(url).toContain(fileName)
  })

  test('[P1] E2E-36-10: Icon-only delete button is at least 44x44 px (AC 45) and deletes the document', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    await expect(page.getByRole('button', { name: 'Attach a document' })).toBeVisible({
      timeout: 30_000,
    })

    const fileName = `to-delete-${Date.now().toString(36)}.pdf`
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from(PDF_MAGIC, 'utf-8'),
    })
    await expect(page.getByText(`${fileName} attached`)).toBeVisible({ timeout: 15_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })

    const row = page.getByRole('row').filter({ hasText: fileName })
    await expect(row).toBeVisible({ timeout: 15_000 })

    const deleteButton = row.getByRole('button', { name: `Delete ${fileName}`, exact: true })
    await expect(deleteButton).toBeVisible()
    const box = (await deleteButton.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)

    page.once('dialog', (dialog) => void dialog.accept())
    await deleteButton.click()
    await expect(page.getByText('Document deleted')).toBeVisible({ timeout: 15_000 })
    await expect(row).toBeHidden({ timeout: 15_000 })
  })

  // =====================================================================
  // AC 42 / AC 45 — Comments thread, composer, delete ownership
  // =====================================================================
  test('[P1] E2E-36-11: Comments tab renders the thread oldest-first with author, avatar initial and timestamp', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Comments' }).click()

    // The pre-seeded comment from the sales rep (created in beforeEach) is visible.
    const salesComment = page.getByText('Pre-sales note from Sales Rep')
    await expect(salesComment).toBeVisible({ timeout: 15_000 })

    const threadItem = salesComment.locator('xpath=ancestor::li[1]')
    await expect(threadItem.getByText('Acme Sales Rep')).toBeVisible()
    // Avatar initial = "AS" (first + last initial).
    await expect(threadItem.getByText('AS', { exact: true })).toBeVisible()
    await expect(threadItem.getByText(/(just now|\d+ (minute|hour|day)s? ago)/)).toBeVisible()

    // Composer + submit affordance for a DEAL:UPDATE user (AC 47).
    await expect(page.getByRole('combobox', { name: 'Comment' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeVisible()
  })

  test('[P1] E2E-36-12: Posting a comment from the composer renders it in the thread', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Comments' }).click()

    const textarea = page.getByRole('combobox', { name: 'Comment' })
    await expect(textarea).toBeVisible({ timeout: 15_000 })
    await textarea.fill('Looking good — please share the updated timeline')
    await page.getByRole('button', { name: 'Comment', exact: true }).click()

    await expect(page.getByText('Comment added')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Looking good — please share the updated timeline')).toBeVisible({
      timeout: 15_000,
    })
    // The composer clears after a successful post.
    await expect(textarea).toHaveValue('')
  })

  test('[P1] E2E-36-13: Delete affordance shows only on the caller own comments; own delete is 44x44', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Comments' }).click()

    await expect(page.getByRole('button', { name: 'User menu' })).toContainText('Acme Admin', {
      timeout: 15_000,
    })

    // The sales-rep comment (not ours) has no delete affordance for admin.
    const salesItem = page
      .getByText('Pre-sales note from Sales Rep')
      .locator('xpath=ancestor::li[1]')
    await expect(salesItem).toBeVisible({ timeout: 15_000 })
    await expect(salesItem.getByRole('button', { name: 'Delete your comment' })).toHaveCount(0)

    // Post our own comment -> the delete button appears and is 44x44 (AC 45).
    const textarea = page.getByRole('combobox', { name: 'Comment' })
    await textarea.fill('Own comment for delete test')
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(page.getByText('Own comment for delete test')).toBeVisible({
      timeout: 15_000,
    })

    const ownItem = page.getByText('Own comment for delete test').locator('xpath=ancestor::li[1]')
    const deleteButton = ownItem.getByRole('button', { name: 'Delete your comment' })
    await expect(deleteButton).toBeVisible()
    const box = (await deleteButton.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)

    page.once('dialog', (dialog) => void dialog.accept())
    await deleteButton.click()
    await expect(page.getByText('Comment deleted')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Own comment for delete test')).toBeHidden({ timeout: 15_000 })
  })

  test('[P1] E2E-36-14: Comment button is disabled for an empty draft (no empty-comment submission)', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Comments' }).click()

    const submit = page.getByRole('button', { name: 'Comment', exact: true })
    await expect(submit).toBeVisible({ timeout: 15_000 })
    await expect(submit).toBeDisabled()
    // Whitespace-only draft is also treated as empty.
    await page.getByRole('combobox', { name: 'Comment' }).fill('   ')
    await expect(submit).toBeDisabled()
  })

  // =====================================================================
  // AC 43 / AC 44 / AC 52 — Mention picker (@ -> listbox -> token -> chip)
  // =====================================================================
  test('[P1] E2E-36-15: Typing @ opens the picker, Enter inserts the token, thread renders a mention chip', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Comments' }).click()

    const textarea = page.getByRole('combobox', { name: 'Comment' })
    await expect(textarea).toBeVisible({ timeout: 15_000 })
    await textarea.click()
    await page.keyboard.type('Let me loop in ')

    // '@' opens the picker with the tenant's active users (AC 43/25).
    await page.keyboard.type('@')
    const listbox = page.getByRole('listbox', { name: 'Mention someone' })
    await expect(listbox).toBeVisible({ timeout: 15_000 })
    // Wait for the candidates query to land before asserting aria-expanded.
    await expect(listbox.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
    await expect(textarea).toHaveAttribute('aria-expanded', 'true')
    await expect(textarea).toHaveAttribute('aria-haspopup', 'listbox')

    // Filter as you type — only the sales rep matches "sal".
    await page.keyboard.type('sal')
    const salesOption = listbox.getByRole('option').filter({ hasText: 'Acme Sales Rep' })
    await expect(salesOption).toBeVisible()
    await expect(listbox.getByRole('option').filter({ hasText: 'Acme Admin' })).toHaveCount(0)

    // ArrowDown/ArrowUp move the highlight; Enter inserts the explicit token.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(listbox).toBeHidden()
    const draft = await textarea.inputValue()
    expect(draft).toContain(`@[Acme Sales Rep](${SALES_USER})`)

    await page.keyboard.type(' with the final numbers')
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(page.getByText('Comment added')).toBeVisible({ timeout: 15_000 })

    // The token renders as a styled mention span, not raw text (AC 44/26).
    const threadText = page.getByText('Let me loop in @Acme Sales Rep with the final numbers')
    await expect(threadText).toBeVisible({ timeout: 15_000 })
    const mentionSpan = threadText.locator('span.rounded.bg-indigo-50')
    await expect(mentionSpan).toHaveText('@Acme Sales Rep')
    await expect(threadText).not.toContainText('[Acme Sales Rep]')
  })

  test('[P1] E2E-36-16: Tab key also inserts the highlighted mention', async ({ page }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Comments' }).click()

    const textarea = page.getByRole('combobox', { name: 'Comment' })
    await expect(textarea).toBeVisible({ timeout: 15_000 })
    await textarea.click()
    await page.keyboard.type('Ask @')
    const listbox = page.getByRole('listbox', { name: 'Mention someone' })
    await expect(listbox).toBeVisible({ timeout: 15_000 })
    await expect(listbox.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Tab')
    await expect(listbox).toBeHidden()
    const draft = await textarea.inputValue()
    expect(draft).toContain('@[')
    expect(draft).toMatch(/@\[[^\]]+\]\([a-f0-9-]{36}\)/u)
  })

  test('[P1] E2E-36-17: Escape closes the picker without clearing the draft or closing the composer', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await page.goto(`/deals/${dealId}`)
    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Comments' }).click()

    const textarea = page.getByRole('combobox', { name: 'Comment' })
    await expect(textarea).toBeVisible({ timeout: 15_000 })
    await textarea.click()
    await page.keyboard.type('Draft survives @')
    const listbox = page.getByRole('listbox', { name: 'Mention someone' })
    await expect(listbox).toBeVisible({ timeout: 15_000 })

    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()
    await expect(textarea).toHaveValue('Draft survives @')
    await expect(textarea).toBeFocused()
    // The composer is still usable.
    await page.keyboard.type('escape test')
    await expect(textarea).toHaveValue('Draft survives @escape test')
  })

  // =====================================================================
  // AC 42 (real-time) — new comments arrive over the subscription
  // =====================================================================
  test.fixme(
    '[P2] E2E-36-18: A comment posted elsewhere appears in the open thread via the subscription',
    async ({ browser, request }) => {
      // BUG (dev environment): with reactStrictMode: true, DealComments'
      // connectGuardRef pattern still double-mounts (setup -> cleanup ->
      // setup). The first mount's WebSocket consumes the single-use
      // ws-token minted by /api/auth/session (server acks, then the client
      // disconnect closes it), and the surviving second mount's reconnects
      // are rejected with 4403 Forbidden because the token is already
      // consumed — so ON_DEAL_COMMENT_ADDED never delivers. Verified: a
      // node-level ws probe with a FRESH token (or a real JWT) connects and
      // receives events, so the server side is fine. WinLossReport uses the
      // identical pattern and is affected the same way. App-level fix:
      // mint a fresh ws-token on every connect attempt, or skip
      // disconnect() for the discarded StrictMode mount.
      test.skip(setupFailed, 'API unavailable — setup data not created')

      const contextA = await browser.newContext()
      await authAs(contextA, ADMIN_USER, 'admin@example.com')
      const pageA = await contextA.newPage()
      await pageA.goto(`/deals/${dealId}`)
      const tablistA = pageA.getByRole('tablist', { name: 'Deal collaboration' })
      await expect(tablistA).toBeVisible({ timeout: 30_000 })
      await pageA.getByRole('tab', { name: 'Comments' }).click()
      await expect(pageA.getByRole('combobox', { name: 'Comment' })).toBeVisible({
        timeout: 15_000,
      })
      await pageA.waitForTimeout(4_000)

      const contextB = await browser.newContext()
      await authAs(contextB, SALES_USER, 'sales@example.com')
      const pageB = await contextB.newPage()
      await pageB.goto(`/deals/${dealId}`)
      const tablistB = pageB.getByRole('tablist', { name: 'Deal collaboration' })
      await expect(tablistB).toBeVisible({ timeout: 30_000 })
      await pageB.getByRole('tab', { name: 'Comments' }).click()
      const textareaB = pageB.getByRole('combobox', { name: 'Comment' })
      await expect(textareaB).toBeVisible({ timeout: 15_000 })
      await textareaB.fill('Realtime hello from another tab')
      await pageB.getByRole('button', { name: 'Comment', exact: true }).click()
      await expect(pageB.getByText('Realtime hello from another tab')).toBeVisible({
        timeout: 15_000,
      })

      await expect(pageA.getByText('Realtime hello from another tab')).toBeVisible({
        timeout: 25_000,
      })

      await contextA.close()
      await contextB.close()
    },
  )

  // =====================================================================
  // AC 47 — permission gating (DEAL:READ-only user)
  // =====================================================================
  test('[P1] E2E-36-19: A DEAL:READ-only user sees the lists but no upload, delete or composer affordances', async ({
    context,
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    await authAs(context, VIEWER_USER, 'viewer@example.com')
    await page.goto(`/deals/${dealId}`)

    const tablist = page.getByRole('tablist', { name: 'Deal collaboration' })
    await expect(tablist).toBeVisible({ timeout: 30_000 })

    // Documents list renders (empty state), but no write affordances.
    await expect(page.getByText('No documents yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Attach a document' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Choose file', exact: true })).toHaveCount(0)
    await expect(page.locator('input[type="file"]')).toHaveCount(0)

    // Comments thread renders (the seeded sales comment), but no composer.
    await page.getByRole('tab', { name: 'Comments' }).click()
    await expect(page.getByText('Pre-sales note from Sales Rep')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('combobox', { name: 'Comment' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Comment', exact: true })).toHaveCount(0)

    // No delete affordance on the sales-rep comment either.
    await expect(page.getByRole('button', { name: 'Delete your comment' })).toHaveCount(0)
  })

  test('[P1] E2E-36-20: Server gates remain the authority — DEAL:READ-only user gets 403 on write APIs', async ({
    request,
  }) => {
    test.skip(setupFailed, 'API unavailable — setup data not created')
    const viewerToken = buildApiJwt(API_JWT_SECRET, VIEWER_USER, TENANT_ID, ['E2E_VIEWER'])

    // GraphQL mutation gates (DEAL:UPDATE). Note: AddDealCommentInput.dealId
    // is typed String! (not ID!) in the Pothos input ref.
    const addComment = await apiGraphql(
      request,
      viewerToken,
      /* GraphQL */ `
        mutation AddDealComment($dealId: String!) {
          addDealComment(input: { dealId: $dealId, comment: "nope" }) {
            id
          }
        }
      `,
      { dealId },
    )
    expect(addComment.body?.errors?.[0]?.message).toContain(
      'Missing required permission: DEAL:UPDATE',
    )

    // Grab a real comment id (reads are allowed for the viewer — DEAL:READ).
    const comments = await apiGraphql(
      request,
      viewerToken,
      /* GraphQL */ `
        query ViewerComments($dealId: ID!) {
          dealComments(dealId: $dealId) {
            items {
              id
            }
          }
        }
      `,
      { dealId },
    )
    const someCommentId: string = comments.body?.data?.dealComments?.items?.[0]?.id ?? dealId

    const deleteComment = await apiGraphql(
      request,
      viewerToken,
      /* GraphQL */ `
        mutation DeleteDealComment($id: ID!) {
          deleteDealComment(id: $id)
        }
      `,
      { id: someCommentId },
    )
    expect(deleteComment.body?.errors?.[0]?.message).toContain(
      'Missing required permission: DEAL:UPDATE',
    )

    // REST upload endpoint (DEAL:UPDATE) -> 403 from the guard.
    const upload = await request.post(`http://127.0.0.1:4000/api/deals/${dealId}/documents`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
      multipart: {
        file: {
          name: 'blocked.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(PDF_MAGIC, 'utf-8'),
        },
      },
    })
    expect(upload.status()).toBe(403)

    // Read APIs stay open (DEAL:READ) — mention candidates included (AC 25).
    const read = await apiGraphql(
      request,
      viewerToken,
      /* GraphQL */ `
        query ViewerRead($dealId: ID!) {
          dealDocuments(dealId: $dealId) {
            id
          }
          dealComments(dealId: $dealId) {
            total
          }
          dealMentionCandidates(dealId: $dealId) {
            id
          }
        }
      `,
      { dealId },
    )
    expect(read.body?.errors).toBeUndefined()
    expect(read.body?.data?.dealMentionCandidates.length).toBeGreaterThanOrEqual(1)
  })

  // =====================================================================
  // E2E-36-21 — upload invalidates the documents list (regression guard)
  // =====================================================================
  test('[P2] E2E-36-21: Uploaded document appears in the list without a manual reload', async ({
    page,
  }) => {
    test.skip(setupFailed, 'API unavailable — login failed')

    await page.goto(`/deals/${dealId}`)
    await expect(page.getByRole('button', { name: 'Attach a document' })).toBeVisible({
      timeout: 30_000,
    })
    await page.locator('input[type="file"]').setInputFiles({
      name: `live-${Date.now().toString(36)}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from(PDF_MAGIC, 'utf-8'),
    })
    await expect(page.getByText(/live-.*\.pdf attached/)).toBeVisible({ timeout: 15_000 })
    // Without a reload the row must appear (regression guard for the
    // invalidateQueries fix in DealDocumentUpload).
    await expect(page.getByRole('row').filter({ hasText: /live-.*\.pdf/ })).toBeVisible({
      timeout: 10_000,
    })
  })
})
