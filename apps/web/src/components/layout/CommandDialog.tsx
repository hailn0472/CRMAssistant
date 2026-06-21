'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import {
  CommandDialog as CmdkDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'

interface CrmCommandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandDialog({ open, onOpenChange }: CrmCommandDialogProps): React.ReactElement {
  const router = useRouter()
  const hasOpenedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      return
    }

    hasOpenedRef.current = true

    requestAnimationFrame(() => {
      const dialog = document.querySelector<HTMLElement>('[cmdk-dialog]')
      dialog?.setAttribute('aria-labelledby', 'crm-command-dialog-title')
      dialog?.setAttribute('aria-describedby', 'crm-command-dialog-description')
    })
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

  // Focus return: after the dialog closes, return focus to the trigger button.
  useEffect(() => {
    if (open || !hasOpenedRef.current) {
      return
    }

    const trigger = document.querySelector<HTMLElement>('[aria-label="Search or run command"]')
    // Defer to next tick so the Radix Dialog has finished its close animation / cleanup.
    requestAnimationFrame(() => {
      trigger?.focus()
    })
  }, [open])

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href)
      onOpenChange(false)
    },
    [router, onOpenChange],
  )

  return (
    <CmdkDialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search or run command"
      aria-describedby="crm-command-dialog-description"
      contentClassName="overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-sm"
      overlayClassName="bg-slate-950/20"
    >
      <h2 id="crm-command-dialog-title" className="sr-only">
        Search or run command
      </h2>
      <p id="crm-command-dialog-description" className="sr-only">
        Search CRM navigation actions and planned command shortcuts.
      </p>
      <CommandInput placeholder="Search or run command..." />

      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => handleNavigate('/dashboard')}>Open Dashboard</CommandItem>
          <CommandItem onSelect={() => handleNavigate('/contacts')}>Open Contacts</CommandItem>
          <CommandItem onSelect={() => handleNavigate('/deals')}>Open Deals</CommandItem>
        </CommandGroup>

        <CommandGroup heading="Create">
          <CommandItem disabled value="create-contact">
            Create Contact
            <span className="ml-auto text-xs text-slate-400">(planned)</span>
          </CommandItem>
          <CommandItem disabled value="create-deal">
            Create Deal
            <span className="ml-auto text-xs text-slate-400">(planned)</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="AI">
          <CommandItem
            disabled
            value="ask-ai"
            className="text-violet-600 data-[selected=true]:bg-violet-50 data-[selected=true]:text-violet-700"
          >
            Ask AI
            <span className="ml-auto text-xs text-violet-400">Planned — AI Query</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="System">
          <CommandItem disabled value="settings">
            Open Settings
            <span className="ml-auto text-xs text-slate-400">(planned)</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CmdkDialog>
  )
}
