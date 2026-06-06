import { act, renderHook } from '@testing-library/react'

import { useAuth } from '../useAuth'
import { authService } from '../../services/auth.service'
import { useAuthStore } from '../../stores/auth.store'

const mockPush = jest.fn()
const mockGetSearchParam = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: mockPush })),
  useSearchParams: jest.fn(() => ({ get: mockGetSearchParam })),
}))

jest.mock('../../services/auth.service', () => ({
  authService: {
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
  },
}))

const mockAuthService = authService as jest.Mocked<typeof authService>

const authResponse = {
  accessToken: 'jwt-token',
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'SALES_REP' as const,
  email: 'user@example.com',
  name: 'Test User',
}

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSearchParam.mockReturnValue(null)
    useAuthStore.getState().clearAuth()
    useAuthStore.getState().setLoading(false)
  })

  it('should login with email/password and populate auth state', async () => {
    mockAuthService.login.mockResolvedValue(authResponse)
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await result.current.login('user@example.com', 'Password123')
    })

    expect(mockAuthService.login).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password123',
    })
    expect(result.current.user).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      email: 'user@example.com',
      name: 'Test User',
    })
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
    expect(result.current.isLoading).toBe(false)
  })

  it('should redirect to safe redirect parameter after login', async () => {
    mockGetSearchParam.mockReturnValue('/contacts?page=1')
    mockAuthService.login.mockResolvedValue(authResponse)
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await result.current.login('user@example.com', 'Password123')
    })

    expect(mockPush).toHaveBeenCalledWith('/contacts?page=1')
  })

  it('should ignore unsafe redirect parameter after login', async () => {
    mockGetSearchParam.mockReturnValue('//evil.example')
    mockAuthService.login.mockResolvedValue(authResponse)
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await result.current.login('user@example.com', 'Password123')
    })

    expect(mockPush).toHaveBeenCalledWith('/dashboard')
  })

  it('should register and populate auth state', async () => {
    mockAuthService.register.mockResolvedValue(authResponse)
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await result.current.register({
        email: 'user@example.com',
        password: 'Password123',
        name: 'Test User',
        tenantName: 'ACME Corp',
      })
    })

    expect(mockAuthService.register).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password123',
      name: 'Test User',
      tenantName: 'ACME Corp',
    })
    expect(result.current.user?.email).toBe('user@example.com')
    expect(result.current.user?.tenantId).toBe('tenant-1')
  })

  it('should logout and clear auth state', async () => {
    mockAuthService.login.mockResolvedValue(authResponse)
    mockAuthService.logout.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await result.current.login('user@example.com', 'Password123')
    })

    await act(async () => {
      await result.current.logout()
    })

    expect(mockAuthService.logout).toHaveBeenCalledWith()
    expect(result.current.user).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(mockPush).toHaveBeenLastCalledWith('/login')
  })

  it('should clear auth state and redirect to login when logout request fails', async () => {
    mockAuthService.login.mockResolvedValue(authResponse)
    mockAuthService.logout.mockRejectedValue(new Error('Logout failed'))
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await result.current.login('user@example.com', 'Password123')
    })

    await act(async () => {
      await result.current.logout()
    })

    expect(mockAuthService.logout).toHaveBeenCalledWith()
    expect(result.current.user).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(mockPush).toHaveBeenLastCalledWith('/login')
  })
})
