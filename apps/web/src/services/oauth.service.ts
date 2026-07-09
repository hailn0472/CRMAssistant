import { supabase } from '@/lib/supabase'

export const oauthService = {
  async initiateGoogleOAuth(redirectPath?: string): Promise<void> {
    const origin = window.location.origin
    const redirectTo = new URL('/callback', origin)
    if (redirectPath) {
      redirectTo.searchParams.set('redirect', redirectPath)
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo.toString(),
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })

    if (error) {
      throw new Error('Không thể khởi tạo đăng nhập Google — vui lòng thử lại')
    }
  },

  async initiateMicrosoftOAuth(redirectPath?: string): Promise<void> {
    const origin = window.location.origin
    const redirectTo = new URL('/callback', origin)
    if (redirectPath) {
      redirectTo.searchParams.set('redirect', redirectPath)
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: redirectTo.toString(),
        scopes: 'openid profile email offline_access',
      },
    })

    if (error) {
      throw new Error('Không thể khởi tạo đăng nhập Microsoft — vui lòng thử lại')
    }
  },
}
