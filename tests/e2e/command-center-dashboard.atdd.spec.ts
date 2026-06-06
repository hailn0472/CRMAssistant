import { expect, test } from '@playwright/test'

import { applyAuthCookie } from '../support/helpers/auth'

test.describe('Command Center dashboard ATDD', () => {
  test.beforeEach(async ({ context }) => {
    await applyAuthCookie(context)
  })

  test('[P1] authenticated user lands on Command Center from the protected default route', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page).not.toHaveURL(/\/contacts$/)
  })

  test('[P1] dashboard skeleton remains readable on mobile, tablet, and desktop viewports', async ({
    page,
  }) => {
    const viewports = [
      { width: 375, height: 667 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.goto('/dashboard')

      await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
      await expect(page.getByRole('region', { name: /priority action queue/i })).toBeVisible()
      await expect(page.getByRole('region', { name: /metric strip/i })).toBeVisible()
      await expect(page.getByRole('region', { name: /recent activity/i })).toBeVisible()
      await expect(
        page.getByRole('region', { name: /role-specific planned sections/i }),
      ).toBeVisible()

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(hasHorizontalOverflow).toBe(false)
    }
  })

  test('[P1] empty account state guides safe first actions', async ({ page }) => {
    await page.goto('/dashboard')

    const firstActions = page.getByRole('region', { name: /first actions|empty dashboard/i })
    await expect(firstActions.getByText(/import contacts/i)).toBeVisible()
    await expect(firstActions.getByText(/create first deal/i)).toBeVisible()
    await expect(
      firstActions.getByRole('button', { name: /import contacts - planned/i }),
    ).toBeDisabled()
    await expect(
      firstActions.getByRole('button', { name: /create first deal - planned/i }),
    ).toBeDisabled()
    await expect(firstActions.getByRole('link')).toHaveCount(0)
  })
})
