import { expect, test } from '@playwright/test'

/**
 * E2E Smoke Test: Homepage renders correctly
 *
 * Validates that the CRMAssistant homepage loads and renders
 * key UI elements from Story 1.2 (shadcn/ui components).
 */
test.describe('Homepage smoke test', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('should display the CRMAssistant title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /CRMAssistant/i })).toBeVisible()
  })

  test('should render the page without errors', async ({ page }) => {
    // Verify no error overlay is visible
    await expect(page.locator('body')).toBeVisible()
    // The main content area should be present
    await expect(page.locator('main')).toBeVisible()
  })

  test('should display shadcn/ui components demo', async ({ page }) => {
    // Verify the demo card is rendered
    await expect(page.getByText('shadcn/ui Components Demo')).toBeVisible()
  })

  test('should render primary button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Primary Button' })).toBeVisible()
  })

  test('should render email input field', async ({ page }) => {
    await expect(page.getByPlaceholder('Nhập email...')).toBeVisible()
  })
})
