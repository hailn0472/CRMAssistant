import { expect, test } from '../support/fixtures'
import { LoginPage } from '../support/page-objects/login-page'

test.describe('Login page smoke test', () => {
  test('should render the public login shell', async ({ page, userFactory }) => {
    const user = userFactory.create()
    const loginPage = new LoginPage(page)

    await test.step('Given a visitor opens the app root', async () => {
      await loginPage.goto()
    })

    await test.step('Then the login form and navigation links are visible', async () => {
      await expect(loginPage.title).toBeVisible()
      await expect(loginPage.emailInput).toBeVisible()
      await expect(loginPage.passwordInput).toBeVisible()
      await expect(loginPage.submitButton).toBeVisible()
      await expect(loginPage.forgotPasswordLink).toBeVisible()
      await expect(loginPage.registerLink).toBeVisible()
    })

    await test.step('And the form accepts realistic factory data', async () => {
      await loginPage.emailInput.fill(user.email)
      await loginPage.passwordInput.fill(user.password)
      await expect(loginPage.emailInput).toHaveValue(user.email)
      await expect(loginPage.passwordInput).toHaveValue(user.password)
    })
  })
})
