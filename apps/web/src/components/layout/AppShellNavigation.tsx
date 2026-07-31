'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Briefcase,
  CheckSquare,
  UserCog,
  Settings,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
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
      },
      { label: 'Deals', href: '/deals', icon: Briefcase },
      { label: 'Tasks', href: '/tasks', icon: CheckSquare },
      {
        label: 'Reports',
        href: '/reports/forecast',
        icon: BarChart3,
        permission: { resource: 'REPORT', action: 'READ' },
      },
      {
        label: 'Win/Loss',
        href: '/reports/win-loss',
        icon: BarChart3,
        permission: { resource: 'REPORT', action: 'READ' },
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
                'px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400/80 mb-1.5',
                sectionIdx > 0 ? 'mt-4' : 'mt-1',
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
                ? 'flex flex-col min-h-11 items-center justify-center gap-0.5 rounded-md text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1'
                : 'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
              isActive && 'border-l-2 border-blue-600 bg-blue-50 text-blue-700 rounded-l-none',
              !isActive && !item.isAi && 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
              !isActive && item.isAi && 'text-violet-700 hover:bg-violet-50',
              !item.href && 'cursor-not-allowed opacity-70',
            )
            const iconEl = (
              <Icon
                aria-hidden="true"
                className={cn(
                  'h-[18px] w-[18px]',
                  compact ? 'h-5 w-5' : 'h-[18px] w-[18px]',
                  isActive && 'text-blue-700',
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
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export function DesktopNavigation(): React.JSX.Element {
  return <NavigationList />
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
            <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
              <div>
                <p className="text-sm font-semibold tracking-tight text-slate-950">CRMAssistant</p>
                <p className="text-xs text-slate-500">Calm CRM workspace</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close navigation menu"
                className="h-11 w-11"
                onClick={closeNavigation}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </div>
            <NavigationList onNavigate={closeNavigation} />
            <div
              aria-label="Current tenant and user"
              className="mx-3 mt-auto mb-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <p className="font-medium text-slate-950">Workspace</p>
              <p className="text-xs text-slate-500">Signed in</p>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
