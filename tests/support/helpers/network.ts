import type { Page, Response } from '@playwright/test'

export function waitForApiResponse(page: Page, urlPattern: string | RegExp): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = response.url()
    const matches = typeof urlPattern === 'string' ? url.includes(urlPattern) : urlPattern.test(url)
    return matches && response.status() < 500
  })
}

export async function mockJsonResponse<TBody>(
  page: Page,
  urlPattern: string | RegExp,
  body: TBody,
  status = 200,
): Promise<void> {
  await page.route(urlPattern, async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}
