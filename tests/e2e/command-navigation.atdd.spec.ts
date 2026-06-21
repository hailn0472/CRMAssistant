import { expect, test } from '@playwright/test'

import { applyAuthCookie } from '../support/helpers/auth'

test.describe('Command Navigation & Search ATDD', () => {
  test.beforeEach(async ({ context }) => {
    await applyAuthCookie(context)
  })

  test('[P1] authenticated user can open command dialog via keyboard shortcut Ctrl+K', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    // Command dialog should NOT be visible before shortcut
    await expect(page.getByRole('dialog', { name: /command|search/i })).not.toBeVisible()

    // Press Ctrl+K / Cmd+K to open
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+KeyK`)

    await expect(page.getByRole('dialog', { name: /command|search/i })).toBeVisible()
  })

  test('[P1] clicking the topbar search trigger opens the command dialog', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page.getByRole('dialog', { name: /command|search/i })).not.toBeVisible()

    await page.getByRole('button', { name: 'Search or run command' }).click()

    await expect(page.getByRole('dialog', { name: /command|search/i })).toBeVisible()
  })

  test('[P1] command dialog shows navigation action groups with enabled and disabled items', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Search or run command' }).click()

    const dialog = page.getByRole('dialog', { name: /command|search/i })

    // Navigate group - enabled
    await expect(dialog.getByRole('option', { name: /open contacts/i })).toBeVisible()
    await expect(dialog.getByRole('option', { name: /open deals/i })).toBeVisible()
    await expect(dialog.getByRole('option', { name: /open dashboard/i })).toBeVisible()

    // Create group - disabled
    await expect(dialog.getByText(/create contact/i)).toBeVisible()
    await expect(dialog.getByText(/create deal/i)).toBeVisible()

    // AI and Settings - disabled
    await expect(dialog.getByText(/ask ai/i)).toBeVisible()
    await expect(dialog.getByText(/settings/i)).toBeVisible()
  })

  test('[P1] selecting an enabled navigate action routes to the target page and closes dialog', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Search or run command' }).click()

    const dialog = page.getByRole('dialog', { name: /command|search/i })
    await dialog.getByRole('option', { name: /open contacts/i }).click()

    await expect(page).toHaveURL(/\/contacts/)
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('[P1] Escape key closes the command dialog', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Search or run command' }).click()

    await expect(page.getByRole('dialog', { name: /command|search/i })).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.getByRole('dialog', { name: /command|search/i })).not.toBeVisible()
  })

  test('[P1] focus returns to the trigger button after closing command dialog', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Search or run command' }).click()

    await page.keyboard.press('Escape')

    await expect(page.getByRole('button', { name: 'Search or run command' })).toBeFocused()
  })

  test('[P2] disabled command items do not navigate on click', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Search or run command' }).click()

    // Verify dialog is open and the Settings item is disabled
    await expect(page.getByRole('dialog', { name: /command|search/i })).toBeVisible()

    const settingsItem = page.getByRole('option', { name: /settings/i })
    await expect(settingsItem).toBeVisible()
    await expect(settingsItem).toHaveAttribute('aria-disabled', 'true')

    const currentUrl = page.url()

    // Click a disabled item — used force: true because cmdk applies
    // pointer-events: none via data-[disabled=true]:pointer-events-none
    await settingsItem.click({ force: true })

    // Dialog remains open and URL does not change
    await expect(page.getByRole('dialog', { name: /command|search/i })).toBeVisible()
    await expect(page).toHaveURL(currentUrl)
  })
})
