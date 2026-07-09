'use client'

import { useQuery } from '@tanstack/react-query'
import { getMyPermissions } from '@/services/permission.service'

export function useMyPermissions(): {
  permissions: { resource: string; action: string; granted: boolean }[]
  isLoading: boolean
  hasPermission: (resource: string, action: string) => boolean
} {
  const { data: permissions = [], isLoading } = useQuery({
    queryKey: ['myPermissions'],
    queryFn: getMyPermissions,
    staleTime: 5 * 60 * 1000,
  })

  const grantMap = new Map<string, boolean>()
  for (const perm of permissions) {
    grantMap.set(`${perm.resource}:${perm.action}`, perm.granted)
  }

  function hasPermission(resource: string, action: string): boolean {
    return grantMap.get(`${resource}:${action}`) ?? false
  }

  return { permissions, isLoading, hasPermission }
}

export function usePermission(resource: string, action: string): boolean {
  const { hasPermission } = useMyPermissions()
  return hasPermission(resource, action)
}
