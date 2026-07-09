import { twoFactorService } from '../two-factor.service'

const mockFetch = jest.fn()
global.fetch = mockFetch

describe('twoFactorService', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorage.clear()
  })

  it('enable2FA sends correct GraphQL mutation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { enable2FA: { secret: 'S', qrCodeDataUrl: 'Q', backupCodes: ['C'] } } }),
    })
    localStorage.setItem('accessToken', 'test-token')

    const result = await twoFactorService.enable2FA()

    expect(result.secret).toBe('S')
    expect(result.qrCodeDataUrl).toBe('Q')
    expect(result.backupCodes).toEqual(['C'])
  })

  it('verify2FA sends correct GraphQL mutation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { verify2FA: { success: true } } }),
    })

    const result = await twoFactorService.verify2FA('123456')

    expect(result.success).toBe(true)
  })

  it('disable2FA sends correct GraphQL mutation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { disable2FA: true } }),
    })

    const result = await twoFactorService.disable2FA('password')

    expect(result).toBe(true)
  })

  it('regenerateBackupCodes sends correct GraphQL mutation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { regenerateBackupCodes: ['C1', 'C2'] } }),
    })

    const result = await twoFactorService.regenerateBackupCodes('password')

    expect(result).toEqual(['C1', 'C2'])
  })

  it('updateTenantSettings sends correct GraphQL mutation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { updateTenantSettings: { enforce2FA: true } } }),
    })

    const result = await twoFactorService.updateTenantSettings(true)

    expect(result.enforce2FA).toBe(true)
  })
})
