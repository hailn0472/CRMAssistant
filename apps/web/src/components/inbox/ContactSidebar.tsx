'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { getDeals } from '@/services/deal.service'

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
}

function initials(firstName?: string, lastName?: string): string {
  const first = firstName?.charAt(0) ?? ''
  const last = lastName?.charAt(0) ?? ''
  return (first + last).toUpperCase() || '?'
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

function formatCloseDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ContactSidebar({ contact, onNewTask }: ContactSidebarProps): React.JSX.Element {
  const router = useRouter()

  const { data: dealsData } = useQuery({
    queryKey: ['contact-open-deal', contact?.id],
    queryFn: () => getDeals(1, 20, { contactId: contact!.id }),
    enabled: !!contact,
  })

  if (!contact) return <div className="flex-1 bg-white" />

  const fullName = `${contact.firstName} ${contact.lastName}`
  const init = initials(contact.firstName, contact.lastName)
  const location = [contact.addressCity, contact.addressCountry].filter(Boolean).join(', ')
  const roleLine = [contact.jobTitle, contact.company].filter(Boolean).join(' · ')

  const openDeal =
    dealsData?.items.find((deal) => !deal.stage?.isWon && !deal.stage?.isLost) ?? null

  const details: Array<{ label: string; value: string }> = [
    { label: 'Email', value: contact.email },
    { label: 'Phone', value: contact.phone ?? '—' },
    { label: 'Company', value: contact.company ?? '—' },
    { label: 'Location', value: location || '—' },
  ]

  return (
    <div className="flex flex-col h-full bg-white overflow-y-auto p-[18px] gap-5">
      {/* Profile */}
      <div className="flex flex-col items-center gap-[9px] text-center">
        <div className="h-[52px] w-[52px] rounded-full bg-[#f0f0f3] flex items-center justify-center text-[15px] font-semibold text-[#4b4b55]">
          {init}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="text-[14.5px] font-semibold text-[#1b1b1f]">{fullName}</div>
          {roleLine && <div className="text-[12px] text-[#8c8c96]">{roleLine}</div>}
        </div>
        <div className="flex gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => router.push(`/contacts/${contact.id}`)}
            className="inline-flex h-[30px] items-center rounded-[8px] border border-[#e6e6eb] bg-white px-[11px] text-[12px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            Open contact
          </button>
          <button
            type="button"
            onClick={() => onNewTask?.(contact.id)}
            className="inline-flex h-[30px] items-center rounded-[8px] border border-[#e6e6eb] bg-white px-[11px] text-[12px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            New task
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="flex flex-col gap-[10px]">
        <div className="text-[11px] font-semibold tracking-[0.08em] text-[#a0a0aa]">DETAILS</div>
        {details.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="flex-none text-[#8c8c96]">{d.label}</span>
            <span className="truncate text-right text-[#1b1b1f]">{d.value}</span>
          </div>
        ))}
      </div>

      {/* Open deal */}
      <div className="flex flex-col gap-[10px]">
        <div className="text-[11px] font-semibold tracking-[0.08em] text-[#a0a0aa]">OPEN DEAL</div>
        {openDeal ? (
          <button
            type="button"
            onClick={() => router.push(`/deals/${openDeal.id}/edit`)}
            className="flex flex-col gap-[7px] rounded-[11px] border border-[#ececf0] px-[13px] py-3 text-left transition-colors hover:bg-[#fafafb]"
          >
            <div className="text-[13px] font-semibold text-[#1b1b1f]">{openDeal.title}</div>
            <div className="flex items-center justify-between gap-2.5">
              <span className="font-mono text-[12.5px] text-[#1b1b1f]">
                {formatCurrency(openDeal.value, openDeal.currency)}
              </span>
              {openDeal.stage && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f4f6] px-[9px] py-[3px] text-[11.5px] font-medium text-[#4b4b55]">
                  <span
                    className="block h-[5px] w-[5px] rounded-full"
                    style={{ background: openDeal.stage.color }}
                  />
                  {openDeal.stage.name}
                </span>
              )}
            </div>
            {formatCloseDate(openDeal.expectedCloseDate) && (
              <div className="text-[11.5px] text-[#a0a0aa]">
                Expected close {formatCloseDate(openDeal.expectedCloseDate)}
              </div>
            )}
          </button>
        ) : (
          <p className="text-[12.5px] text-[#a0a0aa]">No open deal for this contact.</p>
        )}
      </div>
    </div>
  )
}
