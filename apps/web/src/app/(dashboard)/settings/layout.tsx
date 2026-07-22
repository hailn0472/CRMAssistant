'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { getMyPermissions } from '@/services/permission.service'

interface SettingsNavItem {
  label: string
  href: string
  roles?: string[]
  permission?: { resource: string; action: string }
}

// Sections previously living as top-level sidebar items are consolidated here.
// Gating mirrors the old sidebar entries (see AppShellNavigation.tsx history).
const settingsNav: SettingsNavItem[] = [
  { label: 'Bảo mật', href: '/settings' },
  {
    label: 'Teams',
    href: '/settings/teams',
    roles: ['ADMIN'],
    permission: { resource: 'ROLE', action: 'READ' },
  },
  {
    label: 'Roles',
    href: '/settings/roles',
    roles: ['ADMIN'],
    permission: { resource: 'ROLE', action: 'READ' },
  },
  { label: 'Audit Logs', href: '/settings/audit-logs', roles: ['ADMIN'] },
  { label: 'API Keys', href: '/settings/api-keys', roles: ['ADMIN'] },
  {
    label: 'Channels',
    href: '/settings/channels',
    permission: { resource: 'INBOX', action: 'WRITE' },
  },
]

function isItemVisible(
  item: SettingsNavItem,
  userRoles: string[] | null,
  grantedPermissions: Set<string>,
  isPermissionsLoading: boolean,
): boolean {
  if (isPermissionsLoading) return true
  if (item.permission) {
    const key = `${item.permission.resource}:${item.permission.action}`
    if (grantedPermissions.has(key)) return true
    if (grantedPermissions.size === 0 && item.roles) {
      return userRoles !== null && item.roles.some((r) => userRoles.includes(r))
    }
    return false
  }
  if (item.roles) {
    return userRoles !== null && item.roles.some((r) => userRoles.includes(r))
  }
  return true
}

function isActive(pathname: string, href: string): boolean {
  // The Settings root (/settings) must not stay active on its sub-pages.
  if (href === '/settings') return pathname === '/settings'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const pathname = usePathname()
  const userRoles = useAuthStore((state) => state.user?.roles ?? null)
  const isAuthenticated = useAuthStore((state) => !!state.user)

  const { data: permissionChecks, isLoading: isPermissionsLoading } = useQuery({
    queryKey: ['myPermissions'],
    queryFn: getMyPermissions,
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  })

  const grantedPermissions = new Set(
    (permissionChecks ?? []).filter((p) => p.granted).map((p) => `${p.resource}:${p.action}`),
  )

  const visibleItems = settingsNav.filter((item) =>
    isItemVisible(item, userRoles, grantedPermissions, isPermissionsLoading && isAuthenticated),
  )

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <nav aria-label="Settings navigation" className="lg:w-52 lg:shrink-0">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400/80">
          Settings
        </p>
        <ul className="flex flex-row flex-wrap gap-1 lg:flex-col">
          {visibleItems.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
                    active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
