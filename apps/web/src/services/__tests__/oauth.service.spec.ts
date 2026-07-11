import { oauthService } from '../oauth.service'

const mockSignInWithOAuth = jest.fn()

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: jest.fn(() => mockSignInWithOAuth()),
    },
  },
}))

describe('oauthService', () => {
  const originalLocation = window.location

  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:3000' },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  it('initiates Google OAuth with correct provider', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null })

    await oauthService.initiateGoogleOAuth()

    expect(mockSignInWithOAuth).toHaveBeenCalled()
  })

  it('initiates Microsoft OAuth with correct provider', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null })

    await oauthService.initiateMicrosoftOAuth()

    expect(mockSignInWithOAuth).toHaveBeenCalled()
  })

  it('throws when Google OAuth fails', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: new Error('Failed') })

    await expect(oauthService.initiateGoogleOAuth()).rejects.toThrow(
      'Không thể khởi tạo đăng nhập Google',
    )
  })

  it('throws when Microsoft OAuth fails', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: new Error('Failed') })

    await expect(oauthService.initiateMicrosoftOAuth()).rejects.toThrow(
      'Không thể khởi tạo đăng nhập Microsoft',
    )
  })
})
