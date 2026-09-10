'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

import { ContactForm } from '@/components/contacts/ContactForm'
import type { Contact } from '@/services/contact.service'

type ContactFormDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present → editing this contact. Absent → creating a new one. */
  contact?: Contact
  /** Defaults to navigating to the saved contact. */
  onSaved?: (contact: Contact) => void
}

export function ContactFormDrawer({
  open,
  onOpenChange,
  contact,
  onSaved,
}: ContactFormDrawerProps): React.JSX.Element | null {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  if (!open || !mounted) return null

  function handleSaved(savedContact: Contact): void {
    void queryClient.invalidateQueries({ queryKey: ['contacts'] })
    void queryClient.invalidateQueries({ queryKey: ['contacts-stats'] })
    if (contact) {
      void queryClient.invalidateQueries({ queryKey: ['contact', contact.id] })
    }
    onOpenChange(false)
    if (onSaved) {
      onSaved(savedContact)
      return
    }
    router.push(`/contacts/${savedContact.id}`)
  }

  const title = contact ? 'Edit contact' : 'New contact'
  const subtitle = contact
    ? `${contact.firstName} ${contact.lastName} · ${contact.email}`
    : 'Only a name and email are required — fill the rest later.'

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-[#18181c]/32 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-[540px] max-w-full flex-col border-l border-[#ececf0] bg-white shadow-[-24px_0_60px_rgba(20,20,26,0.12)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#f2f2f5] px-6 pb-[18px] pt-[22px]">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#1b1b1f]">{title}</h2>
            <p className="truncate text-[12.5px] text-[#8c8c96]">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close panel"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] border border-[#e6e6eb] bg-white text-[15px] leading-none text-[#6b6b76] transition-colors hover:bg-[#f4f4f6]"
          >
            ×
          </button>
        </div>

        <ContactForm contact={contact} onSaved={handleSaved} onCancel={() => onOpenChange(false)} />
      </div>
    </div>,
    document.body,
  )
}
