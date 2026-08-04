'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Pencil, Check, X } from 'lucide-react'

import { OwnerSection } from '@/components/contacts/OwnerSection'
import { TagBadge } from '@/components/contacts/TagBadge'
import { TagSelector } from '@/components/contacts/TagSelector'
import { ContactFormDrawer } from '@/components/contacts/ContactFormDrawer'
import { addTagToContact, removeTagFromContact } from '@/services/tag.service'
import { updateContact } from '@/services/contact.service'
import { assignContactOwner } from '@/services/owner.service'
import { getConversations } from '@/services/inbox.service'
import { ContactTimeline } from '@/components/contacts/ContactTimeline'
import { cn } from '@/lib/utils'
import type { Contact } from '@/services/contact.service'

type TabId = 'overview' | 'activity' | 'conversations'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'conversations', label: 'Conversations' },
]

const CHANNEL_LABELS: Record<string, string> = {
  FACEBOOK: 'Facebook',
  LIVE_CHAT: 'Live Chat',
  INTERNAL: 'Internal',
}

const CONVERSATION_STATUS: Record<string, { label: string; color: string }> = {
  OPEN: { label: 'Open', color: '#4f46e5' },
  PENDING: { label: 'Pending', color: '#c2860a' },
  RESOLVED: { label: 'Resolved', color: '#22a06b' },
  ARCHIVED: { label: 'Archived', color: '#8c8c96' },
}

function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

// ─── Inline Edit Field ────────────────────────────────
function InlineEditField({
  label,
  value,
  fieldKey,
  contactId,
  onSave,
  multiline,
}: {
  label: string
  value: string | null | undefined
  fieldKey: string
  contactId: string
  onSave: (key: string, val: string) => void
  multiline?: boolean
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // Partial-field PATCH; the mutation's real input type is a full ContactFormData shape.
      await updateContact(contactId, { [fieldKey]: inputVal.trim() || null } as any)
      onSave(fieldKey, inputVal.trim())
      toast.success(`${label} updated`)
      setEditing(false)
    } catch {
      toast.error(`Failed to update ${label}`)
    } finally {
      setSaving(false)
    }
  }, [contactId, fieldKey, inputVal, label, onSave])

  if (editing) {
    const InputTag = multiline ? 'textarea' : 'input'
    return (
      <div className="flex min-w-0 flex-1 items-start gap-1.5">
        <InputTag
          autoFocus
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !multiline) handleSave()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="h-8 w-full rounded-[7px] border border-[#e6e6eb] bg-[#fafafb] px-2.5 text-[13px] text-[#1b1b1f] outline-none transition-colors focus:border-[#1b1b1f] focus:bg-white"
          placeholder={`Enter ${label.toLowerCase()}`}
          rows={multiline ? 3 : undefined}
        />
        <div className="flex shrink-0 gap-1 pt-0.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            aria-label={`Save ${label}`}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#22a06b] transition-colors hover:bg-[#f4f4f6] disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label={`Cancel editing ${label}`}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#a0a0aa] transition-colors hover:bg-[#f4f4f6]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <span className={cn('truncate text-[13.5px]', value ? 'text-[#1b1b1f]' : 'text-[#c7c7d1]')}>
        {value || '—'}
      </span>
      {value ? (
        <button
          type="button"
          aria-label={`Edit ${label}`}
          className="invisible shrink-0 text-[#8c8c96] opacity-0 transition-opacity hover:text-[#1b1b1f] group-hover:visible group-hover:opacity-100"
          onClick={() => {
            setInputVal(value ?? '')
            setEditing(true)
          }}
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : (
        <button
          type="button"
          className="shrink-0 text-[12px] text-[#4338ca] hover:underline"
          onClick={() => {
            setInputVal('')
            setEditing(true)
          }}
        >
          Add
        </button>
      )}
    </>
  )
}

// ─── Field Row (mock's 130px-label grid row) ──────────
function FieldRow({
  label,
  children,
  tall,
}: {
  label: string
  children: React.ReactNode
  tall?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group grid grid-cols-[130px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-[#f4f4f7] px-[18px] last:border-0',
        tall ? 'min-h-[46px] py-2' : 'h-[46px]',
      )}
    >
      <span className="text-[11px] font-semibold tracking-[0.06em] text-[#a0a0aa]">{label}</span>
      {children}
    </div>
  )
}

// ─── Profile Header ───────────────────────────────────
function ProfileHeader({
  contact,
  onEdit,
}: {
  contact: Contact
  onEdit: () => void
}): React.JSX.Element {
  const fullName = `${contact.firstName} ${contact.lastName}`

  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-6">
      <div className="flex min-w-0 items-start gap-3.5">
        <div className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-full bg-[#f0f0f3] text-[14px] font-semibold text-[#4b4b55]">
          {initials(contact.firstName, contact.lastName)}
        </div>
        <div className="flex min-w-0 flex-col gap-[7px]">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
            {fullName}
          </h1>

          <div className="flex flex-wrap items-center gap-3 text-[13px] text-[#77777f]">
            <a
              href={`mailto:${contact.email}`}
              className="text-[13px] text-[#4338ca] hover:underline"
            >
              {contact.email}
            </a>
            {contact.owner ? (
              <>
                <span className="text-[#d8d8e0]">·</span>
                <span>
                  Owner {contact.owner.firstName} {contact.owner.lastName}
                </span>
              </>
            ) : null}
            <span className="text-[#d8d8e0]">·</span>
            <span>Updated {new Date(contact.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={() => toast.success('Sharing is not available yet')}
          className="inline-flex h-9 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
        >
          Share
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black"
        >
          Edit
        </button>
      </div>
    </div>
  )
}

// ─── Tags Section ─────────────────────────────────────
function TagsSection({
  contactId,
  tags,
  onTagsChange,
}: {
  contactId: string
  tags: Contact['tags']
  onTagsChange: () => void
}): React.JSX.Element {
  const [showSelector, setShowSelector] = useState(false)

  const handleRemoveTag = useCallback(
    async (tag: { id: string; name: string; color: string }) => {
      try {
        await removeTagFromContact(contactId, tag.id)
        toast.success(`Tag "${tag.name}" removed`)
        onTagsChange()
      } catch {
        toast.error('Failed to remove tag')
      }
    },
    [contactId, onTagsChange],
  )

  const handleAddTag = useCallback(
    async (tag: { id: string; name: string; color: string }) => {
      try {
        await addTagToContact(contactId, tag.id)
        toast.success(`Tag "${tag.name}" added`)
        setShowSelector(false)
        onTagsChange()
      } catch {
        toast.error('Failed to add tag')
      }
    },
    [contactId, onTagsChange],
  )

  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
      <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Tags</h2>
      <div className="flex flex-wrap items-center gap-[7px]">
        {tags && tags.length > 0 ? (
          tags.map((t) => <TagBadge key={t.id} tag={t} onRemove={handleRemoveTag} />)
        ) : (
          <span className="text-[12.5px] text-[#a0a0aa]">No tags yet</span>
        )}
        <button
          type="button"
          className="inline-flex h-7 items-center rounded-full border border-dashed border-[#d8d8e0] px-[11px] text-[12px] font-medium text-[#4b4b55] transition-colors hover:border-[#1b1b1f] hover:bg-[#fafafb]"
          onClick={() => setShowSelector((v) => !v)}
        >
          {showSelector ? 'Cancel' : '+ Add tag'}
        </button>
      </div>
      {showSelector ? (
        <TagSelector
          contactId={contactId}
          selectedTags={tags ?? []}
          onTagsChange={(newTags) => {
            const existing = new Set((tags ?? []).map((t) => t.id))
            const added = newTags.find((t) => !existing.has(t.id))
            if (added) handleAddTag(added)
          }}
        />
      ) : null}
    </section>
  )
}

// ─── Quick Info ────────────────────────────────────────
function QuickInfoCard({ contact }: { contact: Contact }): React.JSX.Element {
  const items = [
    { label: 'Created', value: new Date(contact.createdAt).toLocaleDateString() },
    { label: 'Updated', value: new Date(contact.updatedAt).toLocaleDateString() },
    { label: 'Company', value: contact.company || '—' },
    { label: 'Job title', value: contact.jobTitle || '—' },
  ]
  return (
    <section className="flex flex-col gap-3.5 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
      {contact.owner ? (
        <div className="flex items-center gap-[11px]">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#f0f0f3] text-[11px] font-semibold text-[#4b4b55]">
            {initials(contact.owner.firstName, contact.owner.lastName)}
          </span>
          <div className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-[13px] font-medium text-[#1b1b1f]">
              {contact.owner.firstName} {contact.owner.lastName}
            </span>
            <span className="truncate text-[11.5px] text-[#a0a0aa]">Owner</span>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'grid grid-cols-2 gap-3',
          contact.owner && 'border-t border-[#f2f2f5] pt-3.5',
        )}
      >
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-[3px]">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-[#a0a0aa]">
              {item.label}
            </span>
            <span className="truncate text-[13px] font-medium text-[#1b1b1f]">{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Profile completeness ──────────────────────────────
function CompletenessCard({ contact }: { contact: Contact }): React.JSX.Element {
  const fields = [
    contact.phone,
    contact.company,
    contact.jobTitle,
    contact.linkedin,
    contact.twitter,
    contact.addressStreet,
    contact.addressCity,
    contact.addressCountry,
    contact.department,
    contact.timezone,
    contact.language,
    contact.source,
  ]
  const filled = fields.filter(Boolean).length
  const total = fields.length
  const pct = Math.round((filled / total) * 100)

  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Profile completeness</h2>
        <span className="font-mono text-[13px] font-medium text-[#1b1b1f]">{pct}%</span>
      </div>
      <span className="block h-2 overflow-hidden rounded-[5px] bg-[#f2f2f5]">
        <span className="block h-full bg-[#1b1b1f]" style={{ width: `${pct}%` }} />
      </span>
      <div className="flex items-center gap-3.5 text-[12px] text-[#8c8c96]">
        <span className="flex items-center gap-1.5">
          <span className="block h-[5px] w-[5px] rounded-full bg-[#22a06b]" />
          {filled} filled
        </span>
        <span className="flex items-center gap-1.5">
          <span className="block h-[5px] w-[5px] rounded-full bg-[#d8d8e0]" />
          {total - filled} missing
        </span>
      </div>
    </section>
  )
}

// ─── Connected channels ─────────────────────────────────
// Derived from the contact's real conversations — there is no separate
// "connected channels" concept in the backend, so this reflects the actual
// distinct channels the contact has messaged through, not a fixed list.
function ChannelsCard({ channels }: { channels: string[] }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
      <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Connected channels</h2>
      <div className="flex flex-wrap items-center gap-[7px]">
        {channels.length === 0 ? (
          <span className="text-[12.5px] text-[#a0a0aa]">No conversations yet</span>
        ) : (
          channels.map((channel) => (
            <span
              key={channel}
              className="inline-flex h-7 items-center gap-[7px] rounded-full border border-[#e6e6eb] bg-[#fafafb] px-[11px] text-[12px] font-medium text-[#4b4b55]"
            >
              <span className="block h-[5px] w-[5px] rounded-full bg-[#22a06b]" />
              {CHANNEL_LABELS[channel] ?? channel}
            </span>
          ))
        )}
      </div>
    </section>
  )
}

// ─── Conversations ────────────────────────────────────
function ConversationsPanel({ contactId }: { contactId: string }): React.JSX.Element {
  const router = useRouter()
  const { data, isLoading } = useQuery({
    queryKey: ['contact-conversations', contactId],
    queryFn: () => getConversations({ page: 1, pageSize: 20 }, { contactId }),
  })

  const items = data?.items ?? []

  return (
    <section className="max-w-[840px] overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[#f2f2f5] px-[18px] py-2.5">
        <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Conversations</h2>
        <button
          type="button"
          onClick={() => router.push('/inbox')}
          className="inline-flex h-9 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-black"
        >
          Open inbox
        </button>
      </div>

      {isLoading ? (
        <p className="px-[18px] py-6 text-[13px] text-[#a0a0aa]">Loading conversations…</p>
      ) : items.length === 0 ? (
        <p className="px-[18px] py-6 text-[13px] text-[#a0a0aa]">No conversations yet.</p>
      ) : (
        items.map((conv) => {
          const status = CONVERSATION_STATUS[conv.status] ?? {
            label: conv.status,
            color: '#8c8c96',
          }
          const title = CHANNEL_LABELS[conv.channel] ?? conv.channel
          const meta = conv.lastMessageAt
            ? `Last message ${new Date(conv.lastMessageAt).toLocaleString()}`
            : 'No messages yet'
          return (
            <button
              key={conv.id}
              type="button"
              onClick={() => router.push('/inbox')}
              className="flex w-full items-center gap-[13px] border-b border-[#f4f4f7] px-[18px] py-3.5 text-left transition-colors last:border-0 hover:bg-[#fafafb]"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-[#ececf0] bg-[#fafafb] text-[10.5px] font-semibold text-[#6b6b76]">
                {title.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex min-w-0 flex-col gap-px">
                <span className="truncate text-[13.5px] font-medium text-[#1b1b1f]">
                  {title} conversation
                </span>
                <span className="truncate text-[12px] text-[#8c8c96]">
                  {meta}
                  {conv.lastMessagePreview ? ` · ${conv.lastMessagePreview}` : ''}
                </span>
              </div>
              <span
                className="ml-auto inline-flex flex-none items-center gap-1.5 rounded-full py-[3px] pl-2 pr-2.5 text-[11.5px] font-medium"
                style={{ color: status.color, background: `${status.color}1a` }}
              >
                <span
                  className="block h-[5px] w-[5px] rounded-full"
                  style={{ background: status.color }}
                />
                {status.label}
              </span>
            </button>
          )
        })
      )}
    </section>
  )
}

// ─── Main Component ───────────────────────────────────
export function ContactDetailClient({ contact }: { contact: Contact }): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [localContact, setLocalContact] = useState(contact)
  const [, setRefreshKey] = useState(0)
  const [editOpen, setEditOpen] = useState(false)

  const { data: conversationsData } = useQuery({
    queryKey: ['contact-conversations', contact.id],
    queryFn: () => getConversations({ page: 1, pageSize: 20 }, { contactId: contact.id }),
  })
  const conversationCount = conversationsData?.total
  const connectedChannels = Array.from(
    new Set((conversationsData?.items ?? []).map((c) => c.channel)),
  )

  const refreshContact = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const handleAssignOwner = useCallback(async (contactId: string, userId: string) => {
    await assignContactOwner(contactId, userId)
  }, [])

  const handleEnrichSave = useCallback((fieldKey: string, value: string) => {
    setLocalContact((prev) => ({ ...prev, [fieldKey]: value || null }))
  }, [])

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <a
        href="/contacts"
        className="mb-4 inline-flex items-center gap-[7px] text-[12.5px] text-[#8c8c96] transition-colors hover:text-[#1b1b1f]"
      >
        ← Back to contacts
      </a>

      <ProfileHeader contact={localContact} onEdit={() => setEditOpen(true)} />

      <div className="mb-5 flex items-center gap-1 border-b border-[#ececf0]">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const badge = tab.id === 'conversations' ? conversationCount : undefined
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex h-[38px] items-center gap-[7px] border-b-2 px-3 text-[13.5px] transition-colors',
                isActive
                  ? 'border-[#1b1b1f] font-semibold text-[#1b1b1f]'
                  : 'border-transparent font-medium text-[#8c8c96] hover:text-[#1b1b1f]',
              )}
            >
              {tab.label}
              {badge ? (
                <span className="rounded-full bg-[#f0f0f3] px-[7px] py-px text-[11px] font-semibold text-[#6b6b76]">
                  {badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-[#f2f2f5] px-[18px] py-[14px]">
                <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Contact information</h2>
              </div>
              <FieldRow label="Email">
                <span className="truncate text-[13.5px] text-[#1b1b1f]">{localContact.email}</span>
                <span />
              </FieldRow>
              <FieldRow label="Phone">
                <InlineEditField
                  label="Phone"
                  value={localContact.phone}
                  fieldKey="phone"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Company">
                <InlineEditField
                  label="Company"
                  value={localContact.company}
                  fieldKey="company"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Job title">
                <InlineEditField
                  label="Job title"
                  value={localContact.jobTitle}
                  fieldKey="jobTitle"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Department">
                <InlineEditField
                  label="Department"
                  value={localContact.department}
                  fieldKey="department"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
            </section>

            <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
              <div className="flex items-start justify-between gap-3 border-b border-[#f2f2f5] px-[18px] py-[14px]">
                <div className="flex flex-col gap-[3px]">
                  <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Enriched information</h2>
                  <span className="text-[12px] text-[#8c8c96]">
                    Fill these in manually — there is no automatic enrichment provider configured.
                  </span>
                </div>
              </div>
              <FieldRow label="LinkedIn">
                <InlineEditField
                  label="LinkedIn"
                  value={localContact.linkedin}
                  fieldKey="linkedin"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Twitter / X">
                <InlineEditField
                  label="Twitter"
                  value={localContact.twitter}
                  fieldKey="twitter"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Address">
                <InlineEditField
                  label="Address"
                  value={[
                    localContact.addressStreet,
                    localContact.addressCity,
                    localContact.addressCountry,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  fieldKey="addressStreet"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Timezone">
                <InlineEditField
                  label="Timezone"
                  value={localContact.timezone}
                  fieldKey="timezone"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Language">
                <InlineEditField
                  label="Language"
                  value={localContact.language}
                  fieldKey="language"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Source">
                <InlineEditField
                  label="Source"
                  value={localContact.source}
                  fieldKey="source"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                />
              </FieldRow>
              <FieldRow label="Notes" tall>
                <InlineEditField
                  label="Notes"
                  value={localContact.notes}
                  fieldKey="notes"
                  contactId={localContact.id}
                  onSave={handleEnrichSave}
                  multiline
                />
              </FieldRow>
            </section>
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <OwnerSection
              contactId={localContact.id}
              ownerId={localContact.ownerId}
              owner={localContact.owner}
              canUpdate={true}
              onAssignOwner={handleAssignOwner}
            />
            <QuickInfoCard contact={localContact} />
            <CompletenessCard contact={localContact} />
            <TagsSection
              contactId={localContact.id}
              tags={localContact.tags}
              onTagsChange={refreshContact}
            />
            <ChannelsCard channels={connectedChannels} />
          </aside>
        </div>
      ) : null}

      {/* ── Activity Tab ── */}
      {activeTab === 'activity' ? (
        <section className="max-w-[840px] overflow-hidden rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
          <ContactTimeline contactId={contact.id} />
        </section>
      ) : null}

      {/* ── Conversations Tab ── */}
      {activeTab === 'conversations' ? <ConversationsPanel contactId={contact.id} /> : null}

      <ContactFormDrawer
        open={editOpen}
        onOpenChange={setEditOpen}
        contact={localContact}
        onSaved={(saved) => {
          setLocalContact(saved)
          setEditOpen(false)
        }}
      />
    </div>
  )
}
