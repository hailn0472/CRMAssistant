import type { Locator, Page } from '@playwright/test'

export class LoginPage {
  readonly title: Locator
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly forgotPasswordLink: Locator
  readonly registerLink: Locator

  constructor(private readonly page: Page) {
    this.title = page.getByRole('heading', { name: 'Đăng nhập' })
    this.emailInput = page.getByRole('textbox', { name: 'Email' })
    this.passwordInput = page.getByRole('textbox', { name: 'Mật khẩu' })
    this.submitButton = page.getByRole('button', { name: 'Đăng nhập' })
    this.forgotPasswordLink = page.getByRole('link', { name: 'Quên mật khẩu?' })
    this.registerLink = page.getByRole('link', { name: 'Đăng ký ngay' })
  }

  async goto(): Promise<void> {
    await this.page.goto('/')
  }
}
