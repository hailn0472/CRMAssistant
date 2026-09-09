'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import { Command, CommandList, CommandGroup, CommandItem } from '@/components/ui/command'

interface CrmCommandDialogProps {
  open: boolean
  query: string
  onOpenChange: (open: boolean) => void
}

export function CommandDialog({
  open,
  query,
  onOpenChange,
}: CrmCommandDialogProps): React.ReactElement {
  const router = useRouter()
  const hasOpenedRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true
    }
  }, [open])

  // Keyboard shortcut: Ctrl+K (or Cmd+K on Mac)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onOpenChange(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (!panelRef.current) {
        return
      }

      const target = event.target as Node
      const trigger = document.querySelector<HTMLElement>('[aria-label="Search or run command"]')

      if (trigger?.contains(target) || panelRef.current.contains(target)) {
        return
      }

      onOpenChangeRef.current(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [])

  // Focus return: after the command dropdown is closed via Escape, return focus to
  // the trigger button. This must NOT fire for navigation closes or click-outside
  // closes — otherwise the trigger's onFocus handler reopens the dialog.
  const closedByEscapeRef = useRef(false)

  useEffect(() => {
    function handleEscapeKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        closedByEscapeRef.current = true
        onOpenChangeRef.current(false)
      }
    }

    document.addEventListener('keydown', handleEscapeKey)
    return () => document.removeEventListener('keydown', handleEscapeKey)
  }, [])

  useEffect(() => {
    if (open || !hasOpenedRef.current || !closedByEscapeRef.current) {
      return
    }

    // Reset immediately so the ref is clean for the next open-close cycle.
    closedByEscapeRef.current = false

    const trigger = document.querySelector<HTMLElement>('[aria-label="Search or run command"]')
    requestAnimationFrame(() => {
      if (trigger) {
        trigger.dataset.returningFocus = ''
        trigger.focus()
      }
    })
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const matches = useCallback(
    (...values: string[]): boolean => {
      if (!normalizedQuery) {
        return true
      }

      return values.some((value) => value.toLowerCase().includes(normalizedQuery))
    },
    [normalizedQuery],
  )

  const showDashboard = matches('open dashboard', 'command center', 'overview')
  const showContacts = matches('open contacts', 'crm contacts', 'customer records')
  const showCreateContact = matches('create contact', 'quick-create workflow')
  const showAskAi = matches('ask ai', 'ai query', 'natural-language crm query')
  const showSettings = matches('open settings', 'workspace preferences')
  const hasResults = showDashboard || showContacts || showCreateContact || showAskAi || showSettings

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href)
      onOpenChange(false)
    },
    [router, onOpenChange],
  )

  if (!open) {
    return <></>
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="crm-command-dialog-title"
      aria-describedby="crm-command-dialog-description"
      className="absolute left-0 top-full z-30 mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/10"
    >
      <h2 id="crm-command-dialog-title" className="sr-only">
        Search or run command
      </h2>
      <p id="crm-command-dialog-description" className="sr-only">
        Search CRM navigation actions and planned command shortcuts.
      </p>

      <Command label="Search or run command">
        <CommandList>
          {!hasResults ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              No matching command found.
            </div>
          ) : null}

          {showDashboard || showContacts ? (
            <CommandGroup heading="Navigate">
              {showDashboard ? (
                <CommandItem onSelect={() => handleNavigate('/dashboard')}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-600">
                    D
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-950">Open Dashboard</span>
                    <span className="block text-xs leading-5 text-slate-500">
                      Go to the dashboard overview
                    </span>
                  </span>
                </CommandItem>
              ) : null}
              {showContacts ? (
                <CommandItem onSelect={() => handleNavigate('/contacts')}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-600">
                    C
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-950">Open Contacts</span>
                    <span className="block text-xs leading-5 text-slate-500">
                      View CRM contacts and customer records
                    </span>
                  </span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          ) : null}

          {showCreateContact ? (
            <CommandGroup heading="Create">
              {showCreateContact ? (
                <CommandItem disabled value="create-contact">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-400">
                    +
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-700">Create Contact</span>
                    <span className="block text-xs leading-5 text-slate-400">
                      Planned quick-create workflow
                    </span>
                  </span>
                  <span className="text-xs text-slate-400">(planned)</span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          ) : null}

          {showAskAi ? (
            <CommandGroup heading="AI">
              <CommandItem
                disabled
                value="ask-ai"
                className="text-violet-600 data-[selected=true]:bg-violet-50 data-[selected=true]:text-violet-700"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-sm font-semibold text-violet-600">
                  AI
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-violet-600">Ask AI</span>
                  <span className="block text-xs leading-5 text-violet-400">
                    Planned natural-language CRM query
                  </span>
                </span>
                <span className="text-xs text-violet-400">Planned — AI Query</span>
              </CommandItem>
            </CommandGroup>
          ) : null}

          {showSettings ? (
            <CommandGroup heading="System">
              <CommandItem disabled value="settings">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-400">
                  ⚙
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-700">Open Settings</span>
                  <span className="block text-xs leading-5 text-slate-400">
                    Planned workspace preferences area
                  </span>
                </span>
                <span className="text-xs text-slate-400">(planned)</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </div>
  )
}
