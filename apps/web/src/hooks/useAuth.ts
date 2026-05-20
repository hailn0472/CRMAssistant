'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { authService } from '../services/auth.service'
import { useAuthStore } from '../stores/auth.store'
import type { AuthUser, RegisterData } from '../types/auth.types'

function safeRedirectTarget(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/contacts'
  }
  return value
}

export function useAuth(): {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
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
        const authUser: AuthUser = {
          userId: response.userId,
          tenantId: response.tenantId,
          role: response.role,
          email: response.email,
          name: response.name,
        }
        setUser(authUser)
        setAccessToken(response.accessToken)
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
          role: response.role,
          email: response.email,
          name: response.name,
        }
        setUser(authUser)
        setAccessToken(response.accessToken)
        router.push('/contacts')
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
    } finally {
      clearAuth()
      setLoading(false)
      router.push('/login')
    }
  }, [clearAuth, setLoading, router])

  return { user, isLoading, login, register, logout }
}
