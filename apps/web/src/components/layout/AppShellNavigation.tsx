'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface NavigationItem {
  label: string
  href?: string
  marker: string
  isAi?: boolean
}

const navigationItems: NavigationItem[] = [
  { label: 'Command Center', href: '/dashboard', marker: 'CC' },
  { label: 'Contacts', href: '/contacts', marker: 'CO' },
  { label: 'Deals', marker: 'DE' },
  { label: 'Activities', marker: 'AC' },
  { label: 'Reports', marker: 'RE' },
  { label: 'AI Query', marker: 'AI', isAi: true },
  { label: 'Settings', marker: 'SE' },
]

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavigationList({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const pathname = usePathname()

  return (
    <nav aria-label="CRM navigation" className="flex flex-col gap-1 px-3 py-4">
      {navigationItems.map((item) => {
        const isActive = item.href ? isActivePath(pathname, item.href) : false
        const className = cn(
          'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
          isActive && 'border-l-2 border-blue-600 bg-blue-50 text-blue-700',
          !isActive && !item.isAi && 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
          !isActive && item.isAi && 'text-violet-700 hover:bg-violet-50',
          !item.href && 'cursor-not-allowed opacity-70',
        )
        const marker = (
          <span
            aria-hidden="true"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md border text-[10px] font-semibold',
              isActive && 'border-blue-200 bg-white text-blue-700',
              !isActive && !item.isAi && 'border-slate-200 bg-slate-50 text-slate-500',
              !isActive && item.isAi && 'border-violet-200 bg-violet-50 text-violet-700',
            )}
          >
            {item.marker}
          </span>
        )

        if (item.href) {
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={className}
              onClick={onNavigate}
            >
              {marker}
              <span>{item.label}</span>
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
            {marker}
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export function DesktopNavigation(): React.JSX.Element {
  return <NavigationList />
}

export function MobileNavigation(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)

  function openNavigation(): void {
    setIsOpen(true)
  }

  function closeNavigation(): void {
    setIsOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open navigation menu"
        aria-expanded={isOpen}
        aria-controls="mobile-crm-navigation"
        className="lg:hidden"
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
            className="absolute inset-0 cursor-default bg-slate-950/30"
            onClick={closeNavigation}
          />
          <aside
            id="mobile-crm-navigation"
            aria-label="Mobile CRM navigation"
            className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-sm"
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
