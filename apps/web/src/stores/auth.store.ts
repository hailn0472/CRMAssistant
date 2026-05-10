import { create } from 'zustand'

import type { AuthUser } from '../types/auth.types'

type AuthState = {
  user: AuthUser | null
  accessToken: string | null
  isLoading: boolean
  setUser: (user: AuthUser | null) => void
  setAccessToken: (token: string | null) => void
  setLoading: (loading: boolean) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setLoading: (isLoading) => set({ isLoading }),
  clearAuth: () => set({ user: null, accessToken: null }),
}))
