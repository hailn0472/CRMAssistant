'use client'

import { useState, useEffect, Suspense } from 'react'

import { useAuthStore } from '@/stores/auth.store'
import { getMe } from '@/services/user.service'
import { AppShellChrome } from './AppShellChrome'
import { DesktopNavigation, MobileNavigation, TabletRailNavigation } from './AppShellNavigation'
import { CommandDialog } from './CommandDialog'
import { TopbarActions } from './TopbarActions'
import { TopbarSearch } from './TopbarSearch'

export { WorkspaceHeader, WorkspacePanel } from './AppShellChrome'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const { user, setUser, setLoading, isLoading } = useAuthStore()

  useEffect(() => {
    let active = true
    if (!user && (isLoading ?? true) && setUser && setLoading) {
      getMe()
        .then((me) => {
          if (!active) return
          setUser({
            userId: me.id,
            tenantId: me.tenantId,
            roles: me.roles ? me.roles.map((r: { name: string }) => r.name) : [],
            email: me.email,
            firstName: me.firstName,
            lastName: me.lastName,
            avatar: me.avatar,
          })
        })
        .catch((err) => {
          if (!active) return
          console.error('[AppShell] Failed to restore user session:', err)
        })
        .finally(() => {
          if (!active) return
          setLoading(false)
        })
    } else if (user && setLoading) {
      setLoading(false)
    }
    return () => {
      active = false
    }
  }, [user, setUser, setLoading, isLoading])

  function openCommand(): void {
    setCommandOpen(true)
  }

  return (
    <AppShellChrome
      sidebarSlot={<DesktopNavigation />}
      tabletRailSlot={<TabletRailNavigation />}
      mobileNavSlot={<MobileNavigation />}
      searchSlot={
        <div className="relative w-[min(38rem,calc(100vw-9rem))]">
          <TopbarSearch
            value={commandQuery}
            onChange={(value) => {
              setCommandQuery(value)
              setCommandOpen(true)
            }}
            onFocus={openCommand}
          />
          <CommandDialog open={commandOpen} query={commandQuery} onOpenChange={setCommandOpen} />
        </div>
      }
      topbarActionsSlot={
        <Suspense fallback={null}>
          <TopbarActions />
        </Suspense>
      }
    >
      {children}
    </AppShellChrome>
  )
}
