'use client'

import { ArrowUpRight, ClipboardCheck, MessageSquareText, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'

type Contact = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
  addressCity?: string | null
  addressCountry?: string | null
}

type ContactSidebarProps = {
  contact?: Contact | null
  onNewTask?: (contactId: string) => void
  conversationStatus?: string
  channel?: string
}

function initials(firstName?: string, lastName?: string): string {
  const first = firstName?.charAt(0) ?? ''
  const last = lastName?.charAt(0) ?? ''
  return (first + last).toUpperCase() || '?'
}

function formatStatus(value?: string): string {
  if (!value) return 'Open'
  return value.charAt(0) + value.slice(1).toLowerCase()
}

export function ContactSidebar({
  contact,
  onNewTask,
  conversationStatus,
  channel,
}: ContactSidebarProps): React.JSX.Element {
  const router = useRouter()

  if (!contact) return <div className="flex-1 bg-white" />

  const fullName = `${contact.firstName} ${contact.lastName}`
  const init = initials(contact.firstName, contact.lastName)
  const location = [contact.addressCity, contact.addressCountry].filter(Boolean).join(', ')
  const roleLine = [contact.jobTitle, contact.company].filter(Boolean).join(' · ')

  const details: Array<{ label: string; value: string }> = [
    { label: 'Email', value: contact.email },
    { label: 'Phone', value: contact.phone ?? '—' },
    { label: 'Company', value: contact.company ?? '—' },
    { label: 'Location', value: location || '—' },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-white p-4">
      {/* Profile */}
      <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-[#eeeef2] bg-[#fcfcfd] px-4 py-4 text-center">
        <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#ebeafe] text-[15px] font-semibold text-[#5147c9]">
          {init}
        </div>
        <div className="flex w-full min-w-0 flex-col gap-0.5">
          <div className="max-w-full truncate text-[14.5px] font-semibold text-[#1b1b1f]">
            {fullName}
          </div>
          {roleLine && (
            <div className="max-w-full truncate text-[12px] text-[#8c8c96]">{roleLine}</div>
          )}
        </div>
        <div className="flex w-full gap-2 pt-1">
          <button
            type="button"
            onClick={() => router.push(`/contacts/${contact.id}`)}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-[#dedee5] bg-white px-2 text-[11.5px] font-semibold text-[#3f3f49] transition-colors hover:bg-[#f5f5f8]"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Review contact
          </button>
          <button
            type="button"
            onClick={() => onNewTask?.(contact.id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#dedee5] bg-white text-[#4b4b55] transition-colors hover:bg-[#f5f5f8]"
            aria-label="Create task for contact"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <section className="rounded-[12px] border border-[#e9e8f6] bg-[#f8f7ff] px-3.5 py-3">
        <div className="flex items-center gap-2 text-[#5147c9]">
          <MessageSquareText className="h-3.5 w-3.5" />
          <span className="text-[10.5px] font-semibold tracking-[0.08em]">
            CONVERSATION CONTEXT
          </span>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3 text-[12px]">
          <span className="text-[#777781]">Channel</span>
          <span className="font-semibold text-[#33333b]">
            {channel === 'FACEBOOK' ? 'Facebook' : channel ?? 'Internal'}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 text-[12px]">
          <span className="text-[#777781]">Status</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#4f46c5]">
            {formatStatus(conversationStatus)}
          </span>
        </div>
      </section>

      <section className="rounded-[12px] border border-[#ececf0] px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10.5px] font-semibold tracking-[0.08em] text-[#9b9ba4]">
              NEXT STEP
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#5d5d67]">
              Review contact context before deciding whether this is a lead.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/contacts/${contact.id}`)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1b1b20] text-white transition-colors hover:bg-black"
            aria-label="Review contact qualification"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      {/* Details */}
      <div className="flex flex-col gap-[10px] px-0.5">
        <div className="text-[11px] font-semibold tracking-[0.08em] text-[#a0a0aa]">DETAILS</div>
        {details.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="flex-none text-[#8c8c96]">{d.label}</span>
            <span className="truncate text-right text-[#1b1b1f]">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
