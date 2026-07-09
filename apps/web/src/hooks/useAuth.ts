'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { authService } from '../services/auth.service'
import { useAuthStore } from '../stores/auth.store'
import type { AuthUser, AuthTokenResponse, RegisterData } from '../types/auth.types'

function safeRedirectTarget(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard'
  }
  return value
}

export function useAuth(): {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  oauthLogin: (accessToken: string, redirect?: string | null) => Promise<void>
  logout: () => Promise<void>
} {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading, setUser, setAccessToken, setLoading, clearAuth } = useAuthStore()

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      setLoading(true)
      try {
        const response = await authService.login({ email, password })
        if ('requires2FA' in response || 'requires2FASetup' in response) {
          // 2FA/2FA setup required — redirect back to login with a flag
          // The login page handles these response types inline
          clearAuth()
          router.push('/login?2fa_required=1')
          return
        }
        const authResponse = response as AuthTokenResponse
        const authUser: AuthUser = {
          userId: authResponse.userId,
          tenantId: authResponse.tenantId,
          roles: authResponse.roles,
          email: authResponse.email,
          firstName: authResponse.firstName,
          lastName: authResponse.lastName,
          avatar: authResponse.avatar,
        }
        setUser(authUser)
        setAccessToken(authResponse.accessToken)
        router.push(safeRedirectTarget(searchParams.get('redirect')))
      } finally {
        setLoading(false)
      }
    },
    [searchParams, setLoading, setUser, setAccessToken, router],
  )

  const register = useCallback(
    async (data: RegisterData): Promise<void> => {
      setLoading(true)
      try {
        const response = await authService.register(data)
        const authUser: AuthUser = {
          userId: response.userId,
          tenantId: response.tenantId,
          roles: response.roles,
          email: response.email,
          firstName: response.firstName,
          lastName: response.lastName,
          avatar: response.avatar,
        }
        setUser(authUser)
        setAccessToken(response.accessToken)
        router.push('/dashboard')
      } finally {
        setLoading(false)
      }
    },
    [setLoading, setUser, setAccessToken, router],
  )

  const oauthLogin = useCallback(
    async (accessToken: string, redirect?: string | null): Promise<void> => {
      setLoading(true)
      try {
        const response = await authService.oauthLogin(accessToken)
        const authUser: AuthUser = {
          userId: response.userId,
          tenantId: response.tenantId,
          roles: response.roles,
          email: response.email,
          firstName: response.firstName,
          lastName: response.lastName,
          avatar: response.avatar,
        }
        setUser(authUser)
        setAccessToken(response.accessToken)
        router.push(safeRedirectTarget(redirect ?? null))
      } finally {
        setLoading(false)
      }
    },
    [setLoading, setUser, setAccessToken, router],
  )

  const logout = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      await authService.logout()
    } catch {
      // Local session cleanup must still complete if the server logout request fails.
    } finally {
      clearAuth()
      setLoading(false)
      router.push('/login')
    }
  }, [clearAuth, setLoading, router])

  return { user, isLoading, login, register, oauthLogin, logout }
}
