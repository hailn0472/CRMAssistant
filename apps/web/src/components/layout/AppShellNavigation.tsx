'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  CheckSquare,
  CalendarDays,
  UserCog,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { useAuth } from '@/hooks/useAuth'
import { getMyPermissions } from '@/services/permission.service'

interface NavigationPermission {
  resource: string
  action: string
}

interface NavigationItem {
  label: string
  href?: string
  icon: LucideIcon
  isAi?: boolean
  roles?: string[]
  permission?: NavigationPermission
  badge?: number
}

interface NavigationSection {
  title: string
  items: NavigationItem[]
}

// Team/Role/Audit-log/API-key/Channel management live under `/settings/*` and
// are surfaced via the Settings sub-navigation (see settings/layout.tsx) rather
// than crowding the top-level sidebar.
const navigationSections: NavigationSection[] = [
  {
    title: 'Main',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      {
        label: 'Contacts',
        href: '/contacts',
        icon: Users,
        permission: { resource: 'CONTACT', action: 'READ' },
      },
      {
        label: 'Inbox',
        href: '/inbox',
        icon: MessageSquare,
        permission: { resource: 'INBOX', action: 'READ' },
        badge: 4,
      },
      {
        label: 'Tasks',
        href: '/tasks',
        icon: CheckSquare,
        permission: { resource: 'TASK', action: 'READ' },
      },
      {
        // Story 4.4 (AC 38): Activities is a top-level primary group entry
        // (ux-design-specification.md:1823). Gated on the existing TASK:READ
        // resource — no new permission resource (AC 13).
        label: 'Activities',
        href: '/activities',
        icon: CalendarDays,
        permission: { resource: 'TASK', action: 'READ' },
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        label: 'Users',
        href: '/users',
        icon: UserCog,
        roles: ['ADMIN', 'SALES_MANAGER'],
        permission: { resource: 'USER', action: 'READ' },
      },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
]

function getVisibleSections(
  userRoles: string[] | null,
  grantedPermissions: Set<string>,
  isPermissionsLoading = false,
): NavigationSection[] {
  return navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        // Show all items while permissions are loading to avoid flash
        if (isPermissionsLoading) return true
        // Permission-based gating takes priority
        if (item.permission) {
          const key = `${item.permission.resource}:${item.permission.action}`
          if (grantedPermissions.has(key)) return true
          // Fallback to role-based gating if user has no permission data yet
          if (grantedPermissions.size === 0 && item.roles) {
            return userRoles !== null && item.roles.some((r) => userRoles.includes(r))
          }
          return false
        }
        // Role-based fallback
        if (item.roles) {
          return userRoles !== null && item.roles.some((r) => userRoles.includes(r))
        }
        // No restriction
        return true
      }),
    }))
    .filter((section) => section.items.length > 0)
}

function isActivePath(pathname: string, href: string, allHrefs: string[]): boolean {
  if (pathname === href) return true
  if (!pathname.startsWith(`${href}/`)) return false
  // Check if there is a more specific (longer) matching href in the navigation
  return !allHrefs.some(
    (otherHref) =>
      otherHref !== href &&
      otherHref.startsWith(`${href}/`) &&
      (pathname === otherHref || pathname.startsWith(`${otherHref}/`)),
  )
}

function NavigationList({
  onNavigate,
  compact,
}: {
  onNavigate?: () => void
  compact?: boolean
}): React.JSX.Element {
  const pathname = usePathname()
  const userRoles = useAuthStore((state) => state.user?.roles ?? null)
  const isAuthenticated = useAuthStore((state) => !!state.user)
  const isAuthLoading = useAuthStore((state) => state.isLoading)

  const { data: permissionChecks, isLoading: isQueryLoading } = useQuery({
    queryKey: ['myPermissions'],
    queryFn: getMyPermissions,
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  })

  // Treat unready auth the same as loading permissions — show all items
  // until we know for sure which ones the user can see. This prevents a
  // "flash of partial nav" then "full nav" split-second jump.
  const isPermissionsLoading = isQueryLoading || isAuthLoading

  const grantedPermissions = new Set(
    (permissionChecks ?? []).filter((p) => p.granted).map((p) => `${p.resource}:${p.action}`),
  )

  const sections = getVisibleSections(userRoles, grantedPermissions, isPermissionsLoading)

  const allHrefs = sections
    .flatMap((s) => s.items.map((i) => i.href))
    .filter((h): h is string => !!h)

  return (
    <nav
      aria-label="CRM navigation"
      className={cn('flex flex-col gap-2', compact ? 'px-1 py-4' : 'px-3 py-4')}
    >
      {sections.map((section, sectionIdx) => (
        <div key={section.title} className="flex flex-col gap-1">
          {sectionIdx > 0 && compact && <hr className="my-2 border-slate-100" />}
          {!compact && (
            <div
              className={cn(
                'px-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400 mb-1.5',
                sectionIdx > 0 ? 'mt-5' : 'mt-1',
              )}
            >
              {section.title}
            </div>
          )}
          {section.items.map((item) => {
            const Icon = item.icon
            const isActive = item.href ? isActivePath(pathname, item.href, allHrefs) : false
            const className = cn(
              compact
                ? 'flex flex-col min-h-11 items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1'
                : 'flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2',
              isActive && 'bg-slate-900 text-white shadow-sm',
              !isActive && !item.isAi && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              !isActive && item.isAi && 'text-violet-700 hover:bg-violet-50',
              !item.href && 'cursor-not-allowed opacity-70',
            )
            const iconEl = (
              <Icon
                aria-hidden="true"
                className={cn(
                  'h-[18px] w-[18px]',
                  compact ? 'h-5 w-5' : 'h-[18px] w-[18px]',
                  isActive && 'text-white',
                  !isActive && !item.isAi && 'text-slate-400',
                  !isActive && item.isAi && 'text-violet-500',
                )}
              />
            )

            if (item.href) {
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={compact ? item.label : undefined}
                  className={className}
                  onClick={onNavigate}
                >
                  {iconEl}
                  {!compact && <span>{item.label}</span>}
                  {item.badge !== undefined && !compact && (
                    <span className="ml-auto flex h-4 min-w-[18px] items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10.5px] font-semibold text-slate-500">
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            }

            return (
              <button
                key={item.label}
                type="button"
                disabled
                aria-label={`${item.label} coming soon`}
                className={className}
              >
                {iconEl}
                {!compact && <span>{item.label}</span>}
                {item.badge !== undefined && !compact && (
                  <span className="ml-auto flex h-4 min-w-[18px] items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10.5px] font-semibold text-slate-500">
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

const ROLE_PRIORITY: Record<string, number> = {
  ADMIN: 0,
  SALES_MANAGER: 1,
  SUPPORT_AGENT: 2,
  MARKETING_USER: 3,
  SALES_REP: 4,
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  SALES_MANAGER: 'Sales Manager',
  SALES_REP: 'Sales Rep',
  SUPPORT_AGENT: 'Support Agent',
  MARKETING_USER: 'Marketing',
}

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-purple-50 text-purple-700 border-purple-200/60',
  SALES_MANAGER: 'bg-blue-50 text-blue-700 border-blue-200/60',
  SALES_REP: 'bg-slate-50 text-slate-700 border-slate-200/60',
  SUPPORT_AGENT: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  MARKETING_USER: 'bg-amber-50 text-amber-700 border-amber-200/60',
}

function getPrimaryRole(roles: string[]): string | null {
  if (roles.length === 0) return null
  let primary = roles[0]
  let primaryPriority = ROLE_PRIORITY[primary] ?? 99
  for (const r of roles) {
    const p = ROLE_PRIORITY[r] ?? 99
    if (p < primaryPriority) {
      primary = r
      primaryPriority = p
    }
  }
  return primary
}

export function SidebarUserProfileMenu({
  onNavigate,
}: {
  onNavigate?: () => void
}): React.JSX.Element {
  const { user } = useAuthStore()
  const { logout } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const firstName = user?.firstName ?? 'Acme'
  const lastName = user?.lastName ?? 'Admin'
  const email = user?.email ?? 'admin@example.co'
  const userRoles = user?.roles ?? []
  const primaryRole = getPrimaryRole(userRoles)
  const initials = `${firstName.charAt(0) || 'A'}${lastName.charAt(0) || 'A'}`.toUpperCase()

  const closeDropdown = useCallback(() => setDropdownOpen(false), [])
  const toggleDropdown = useCallback(() => setDropdownOpen((prev) => !prev), [])

  const handleLogout = useCallback(async () => {
    closeDropdown()
    if (onNavigate) onNavigate()
    await logout()
  }, [closeDropdown, logout, onNavigate])

  useEffect(() => {
    if (!dropdownOpen) return
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setDropdownOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [dropdownOpen])

  const roleColor = primaryRole
    ? ROLE_COLORS[primaryRole] ?? 'bg-slate-50 text-slate-700 border-slate-200/60'
    : ''
  const roleLabel = primaryRole ? ROLE_LABELS[primaryRole] ?? primaryRole : ''

  return (
    <div className="relative mt-auto border-t border-slate-100 p-3.5">
      <button
        type="button"
        aria-label="User profile menu"
        aria-expanded={dropdownOpen}
        aria-haspopup="true"
        className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-600/40"
        onClick={toggleDropdown}
      >
        {user?.avatar ? (
          <img
            src={user.avatar}
            alt={`${firstName} ${lastName}`}
            className="h-8 w-8 shrink-0 rounded-full object-cover border border-slate-100 shadow-sm"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[11px] font-bold text-white shadow-sm">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs font-semibold text-slate-900">
            {firstName} {lastName}
          </p>
          <p className="truncate text-[10.5px] text-slate-400">{email}</p>
        </div>
      </button>

      {dropdownOpen && (
        <>
          <button
            type="button"
            aria-label="Close user profile menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={closeDropdown}
          />
          <div className="absolute bottom-full left-3.5 right-3.5 mb-2 z-50 rounded-xl border border-slate-200 bg-white p-3 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2 duration-150">
            {/* User Info Header */}
            <div className="flex items-center gap-3 px-1 py-1.5 mb-2">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={`${firstName} ${lastName}`}
                  className="h-10 w-10 shrink-0 rounded-full object-cover border border-slate-100"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white shadow-sm">
                  {initials}
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {firstName} {lastName}
                </p>
                <p className="text-xs text-slate-500 truncate mb-1">{email}</p>
                {primaryRole && (
                  <span
                    className={`inline-flex items-center self-start rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleColor}`}
                  >
                    {roleLabel}
                  </span>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 my-2" />

            {/* Menu options */}
            <div className="space-y-0.5">
              <Link
                href="/settings"
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => {
                  closeDropdown()
                  if (onNavigate) onNavigate()
                }}
              >
                <Settings className="h-4 w-4 text-slate-400" />
                <span>Settings</span>
              </Link>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 text-red-400" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function DesktopNavigation(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col justify-between">
      <NavigationList />
      <SidebarUserProfileMenu />
    </div>
  )
}

export function TabletRailNavigation(): React.JSX.Element {
  return <NavigationList compact />
}

export function MobileNavigation(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  const openNavigation = useCallback((): void => {
    setIsOpen(true)
  }, [])

  const closeNavigation = useCallback((): void => {
    setIsOpen(false)
  }, [])

  // Focus trap, scroll lock, Escape key, and aria-hidden on main content
  useEffect(() => {
    if (!isOpen) return

    const drawer = drawerRef.current
    const hamburger = hamburgerRef.current
    if (!drawer) return

    // Lock body scroll
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus first focusable element
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusableElements = drawer.querySelectorAll<HTMLElement>(focusableSelector)
    const firstFocusable = focusableElements[0]
    const lastFocusable = focusableElements[focusableElements.length - 1]

    firstFocusable?.focus()

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        closeNavigation()
        return
      }
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === firstFocusable) {
          e.preventDefault()
          lastFocusable?.focus()
        } else if (!e.shiftKey && document.activeElement === lastFocusable) {
          e.preventDefault()
          firstFocusable?.focus()
        }
      }
    }

    drawer.addEventListener('keydown', handleKeyDown)

    // Set aria-hidden on main content
    const mainContent = document.querySelector('main[aria-label="CRM workspace"]')
    mainContent?.setAttribute('aria-hidden', 'true')

    return () => {
      document.body.style.overflow = originalOverflow
      drawer.removeEventListener('keydown', handleKeyDown)
      mainContent?.removeAttribute('aria-hidden')
      // Return focus to hamburger trigger on close
      hamburger?.focus()
    }
  }, [isOpen, closeNavigation])

  return (
    <>
      <Button
        ref={hamburgerRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open navigation menu"
        aria-expanded={isOpen}
        aria-controls="mobile-crm-navigation"
        className="h-11 w-11 lg:hidden"
        onClick={openNavigation}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ≡
        </span>
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 cursor-default bg-slate-950/30 transition-opacity duration-200"
            onClick={closeNavigation}
          />
          <aside
            ref={drawerRef}
            id="mobile-crm-navigation"
            role="complementary"
            aria-label="Mobile CRM navigation"
            className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-sm transition-transform duration-200"
          >
            <div className="flex h-16 items-center justify-between gap-2 border-b border-slate-200 px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-[13px] font-bold text-white">
                  C
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-semibold tracking-tight text-slate-900">
                    CRMAssistant
                  </p>
                  <p className="truncate text-[11px] text-slate-500">Calm workspace</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close navigation menu"
                className="h-11 w-11 shrink-0"
                onClick={closeNavigation}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </div>
            <NavigationList onNavigate={closeNavigation} />
            <SidebarUserProfileMenu onNavigate={closeNavigation} />
          </aside>
        </div>
      )}
    </>
  )
}
