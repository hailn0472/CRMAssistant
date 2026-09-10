import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useMyPermissions, usePermission } from '../usePermission'
import * as permissionService from '@/services/permission.service'

jest.mock('@/services/permission.service')

const mockGetMyPermissions = permissionService.getMyPermissions as jest.MockedFunction<
  typeof permissionService.getMyPermissions
>

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return React.createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useMyPermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns permissions when loaded', async () => {
    mockGetMyPermissions.mockResolvedValue([
      { resource: 'CONTACT', action: 'READ', granted: true },
      { resource: 'CONTACT', action: 'DELETE', granted: false },
    ])

    const { result } = renderHook(() => useMyPermissions(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.permissions).toHaveLength(2)
    expect(result.current.hasPermission('CONTACT', 'READ')).toBe(true)
    expect(result.current.hasPermission('CONTACT', 'DELETE')).toBe(false)
  })

  it('hasPermission returns false for unknown permission', async () => {
    mockGetMyPermissions.mockResolvedValue([])

    const { result } = renderHook(() => useMyPermissions(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.hasPermission('UNKNOWN', 'READ')).toBe(false)
  })

  it('handles loading state', () => {
    mockGetMyPermissions.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useMyPermissions(), { wrapper })

    expect(result.current.isLoading).toBe(true)
  })
})

describe('usePermission', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns true when permission granted', async () => {
    mockGetMyPermissions.mockResolvedValue([{ resource: 'CONTACT', action: 'READ', granted: true }])

    const { result } = renderHook(() => usePermission('CONTACT', 'READ'), { wrapper })

    await waitFor(() => {
      expect(result.current).toBe(true)
    })
  })

  it('returns false when permission not granted', async () => {
    mockGetMyPermissions.mockResolvedValue([{ resource: 'CONTACT', action: 'READ', granted: true }])

    const { result } = renderHook(() => usePermission('USER', 'DELETE'), { wrapper })

    await waitFor(() => {
      expect(result.current).toBe(false)
    })
  })
})
