import { render, screen, waitFor } from '@testing-library/react'

import OAuthCallbackPage from '../callback/page'
import { supabase } from '@/lib/supabase'

const mockPush = jest.fn()
const mockReplace = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: mockPush, replace: mockReplace })),
  useSearchParams: jest.fn(() => ({
    get: jest.fn((key: string) => (key === 'redirect' ? '/contacts' : null)),
  })),
}))

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
  },
}))

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(() => ({
    oauthLogin: jest.fn().mockResolvedValue(undefined),
  })),
}))

describe('OAuth callback page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows loading spinner on mount', () => {
    ;(supabase.auth.getSession as jest.Mock).mockReturnValue(new Promise(() => undefined))

    render(<OAuthCallbackPage />)

    expect(screen.getByText('Đang xác thực với Google...')).toBeInTheDocument()
  })

  it('redirects to login on error when getSession fails', async () => {
    ;(supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: new Error('Auth session missing'),
    })

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login?error=oauth_failed')
    })
  })

  it('redirects to login when session has no access_token', async () => {
    ;(supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: {} },
      error: null,
    })

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login?error=oauth_failed')
    })
  })
})
