'use client'

import { useState } from 'react'

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
      topbarActionsSlot={<TopbarActions />}
    >
      {children}
    </AppShellChrome>
  )
}
