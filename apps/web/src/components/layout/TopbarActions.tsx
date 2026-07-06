'use client'

import { useCallback, useState, useEffect } from 'react'
import Link from 'next/link'
import { Bell, LogOut, Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth.store'
import { useAuth } from '@/hooks/useAuth'

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

function RoleBadge({ role }: { role: string }): React.JSX.Element {
  const color = ROLE_COLORS[role] ?? 'bg-slate-50 text-slate-700 border-slate-200/60'
  const label = ROLE_LABELS[role] ?? role
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color}`}
    >
      {label}
    </span>
  )
}

interface AvatarOrInitialsProps {
  avatar?: string | null
  firstName: string
  lastName: string
  size?: string
}

function AvatarOrInitials({
  avatar,
  firstName,
  lastName,
  size = 'h-7 w-7',
}: AvatarOrInitialsProps): React.JSX.Element {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={`${firstName} ${lastName}`}
        className={`${size} rounded-full object-cover border border-slate-100 shadow-sm`}
      />
    )
  }

  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()

  const colors = [
    'from-indigo-500 to-blue-600',
    'from-emerald-500 to-teal-600',
    'from-purple-500 to-pink-600',
    'from-amber-500 to-orange-600',
  ]
  const charSum = firstName.charCodeAt(0) + (lastName.charCodeAt(0) || 0)
  const gradient = colors[charSum % colors.length]

  return (
    <span
      aria-hidden="true"
      className={`flex ${size} items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-[10px] font-bold text-white shadow-sm`}
    >
      {initials}
    </span>
  )
}

export function TopbarActions(): React.JSX.Element {
  const { user } = useAuthStore()
  const { logout } = useAuth()
  const userRoles = user?.roles ?? []
  const primaryRole = getPrimaryRole(userRoles)
  const firstName = user?.firstName ?? ''
  const lastName = user?.lastName ?? ''
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const closeDropdown = useCallback(() => setDropdownOpen(false), [])
  const toggleDropdown = useCallback(() => setDropdownOpen((prev) => !prev), [])

  const handleLogout = useCallback(async () => {
    closeDropdown()
    await logout()
  }, [closeDropdown, logout])

  // Close dropdown on Escape key
  useEffect(() => {
    if (!dropdownOpen) return

    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setDropdownOpen(false)
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [dropdownOpen])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="View notifications"
        className="h-11 w-11 rounded-full border-slate-200 bg-white text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-blue-600/40"
      >
        <Bell className="h-4 w-4" />
      </Button>

      {/* User menu wrapper */}
      <div className="relative">
        {/* Desktop user badge */}
        <button
          type="button"
          aria-label="User menu"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
          className="hidden lg:flex h-10 items-center gap-2.5 rounded-full border border-slate-200 bg-white pl-1.5 pr-3.5 text-sm hover:bg-slate-50 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600/40"
          onClick={toggleDropdown}
        >
          <div className="shrink-0">
            <AvatarOrInitials
              avatar={user?.avatar}
              firstName={firstName}
              lastName={lastName}
              size="h-7 w-7"
            />
          </div>
          <div className="leading-tight text-left min-w-0 max-w-[120px]">
            <p className="text-xs font-semibold text-slate-900 truncate">
              {firstName} {lastName}
            </p>
            {primaryRole ? (
              <p className="text-[10px] text-slate-500 font-medium truncate">
                {ROLE_LABELS[primaryRole] ?? primaryRole}
              </p>
            ) : (
              <p className="text-[10px] text-slate-500 truncate">Signed in</p>
            )}
          </div>
        </button>

        {/* Mobile/tablet compact user badge */}
        <button
          type="button"
          aria-label="User menu"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
          className="flex lg:hidden h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600/40"
          onClick={toggleDropdown}
        >
          <AvatarOrInitials
            avatar={user?.avatar}
            firstName={firstName}
            lastName={lastName}
            size="h-7 w-7"
          />
        </button>

        {/* Shared dropdown */}
        {dropdownOpen ? (
          <>
            <button
              type="button"
              aria-label="Close user menu"
              className="fixed inset-0 z-30 cursor-default"
              onClick={closeDropdown}
            />
            <div className="absolute right-0 mt-2 z-40 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 duration-150">
              {/* User Info Header */}
              <div className="flex items-center gap-3 px-1 py-1.5 mb-2">
                <AvatarOrInitials
                  avatar={user?.avatar}
                  firstName={firstName}
                  lastName={lastName}
                  size="h-10 w-10"
                />
                <div className="flex flex-col min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {firstName} {lastName}
                  </p>
                  <p className="text-xs text-slate-500 truncate mb-1.5">{user?.email ?? ''}</p>
                  <div className="flex">{primaryRole && <RoleBadge role={primaryRole} />}</div>
                </div>
              </div>

              <div className="border-t border-slate-100 my-2" />

              {/* Menu options */}
              <div className="space-y-0.5">
                <Link
                  href="/settings"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  onClick={closeDropdown}
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
        ) : null}
      </div>
    </>
  )
}
