'use client'

import { useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  Pencil,
  Share2,
  MoreHorizontal,
  Mail,
  Phone,
  User,
  Clock,
  Globe,
  MessageSquare,
  Plus,
  CheckCircle2,
  Circle,
  Check,
  X,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { TagBadge } from '@/components/contacts/TagBadge'
import { TagSelector } from '@/components/contacts/TagSelector'
import { OwnerSection } from '@/components/contacts/OwnerSection'
import { addTagToContact, removeTagFromContact } from '@/services/tag.service'
import { updateContact } from '@/services/contact.service'
import { assignContactOwner } from '@/services/owner.service'
import { cn } from '@/lib/utils'
import type { Contact } from '@/services/contact.service'

// ─── Types ────────────────────────────────────────────
type TabId = 'overview' | 'activity' | 'conversations'

interface Tab {
  id: TabId
  label: string
  icon: LucideIcon
  badge?: string
}

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'activity', label: 'Activity', icon: Clock, badge: '6' },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare, badge: '3' },
]

const ACTIVITIES = [
  {
    type: 'conversation' as const,
    icon: MessageSquare,
    color: 'bg-blue-100 text-blue-600',
    headline: 'New conversation via Facebook',
    time: 'Today at 14:32',
    detail: 'Khách hàng hỏi về báo giá giải pháp CRM cho doanh nghiệp vừa và nhỏ.',
  },
  {
    type: 'update' as const,
    icon: Pencil,
    color: 'bg-emerald-100 text-emerald-600',
    headline: 'Contact updated by Lan Tran',
    time: 'Yesterday at 09:15',
    detail:
      'Job title changed from "Software Engineer" → "Senior Software Engineer". Tag "VIP" added.',
  },
  {
    type: 'note' as const,
    icon: MessageSquare,
    color: 'bg-indigo-100 text-indigo-600',
    headline: 'Internal note added by Lan Tran',
    time: '3 days ago',
    detail: 'Khách hàng tiềm năng cho gói Enterprise.',
  },
  {
    type: 'system' as const,
    icon: User,
    color: 'bg-slate-100 text-slate-500',
    headline: 'Contact created',
    time: '15 Jan 2026',
  },
  {
    type: 'conversation' as const,
    icon: MessageSquare,
    color: 'bg-blue-100 text-blue-600',
    headline: 'Previous conversation via Live Chat',
    time: '10 Jan 2026',
    detail: 'Khách hàng tham quan tính năng qua demo online.',
  },
  {
    type: 'system' as const,
    icon: CheckCircle2,
    color: 'bg-emerald-100 text-emerald-600',
    headline: 'Contact shared with Team Sales',
    time: '8 Jan 2026',
  },
]

const CONVERSATIONS = [
  {
    title: 'Báo giá CRM Enterprise',
    channel: 'Facebook',
    channelIcon: MessageSquare,
    channelColor: 'bg-blue-100 text-blue-600',
    lastMessage: 'Today at 14:32',
    messageCount: '12 messages',
    status: 'Open' as const,
  },
  {
    title: 'Demo product tour',
    channel: 'Live Chat',
    channelIcon: MessageSquare,
    channelColor: 'bg-emerald-100 text-emerald-600',
    lastMessage: '10 Jan 2026',
    messageCount: '24 messages',
    status: 'Resolved' as const,
  },
  {
    title: 'Follow-up: Proposal feedback',
    channel: 'Email',
    channelIcon: Mail,
    channelColor: 'bg-indigo-100 text-indigo-600',
    lastMessage: '5 Jan 2026',
    messageCount: undefined,
    status: 'Resolved' as const,
  },
]

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
      <div className="flex items-start gap-2">
        <InputTag
          autoFocus
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !multiline) handleSave()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="h-8 w-full rounded-md border border-slate-300 px-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder={`Enter ${label.toLowerCase()}`}
          rows={multiline ? 3 : undefined}
        />
        <div className="flex gap-1 shrink-0 pt-0.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {value ? (
        <span className="text-sm font-medium text-slate-900">{value}</span>
      ) : (
        <span className="italic text-slate-300">—</span>
      )}
      <button
        type="button"
        className="invisible ml-auto shrink-0 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-600 opacity-0 transition-all group-hover:visible group-hover:opacity-100 hover:bg-indigo-100"
        onClick={() => {
          setInputVal(value ?? '')
          setEditing(true)
        }}
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Profile Header ───────────────────────────────────
function ProfileHeader({
  contact,
  onSave,
}: {
  contact: Contact
  onSave: (k: string, v: string) => void
}): React.JSX.Element {
  const initials = `${contact.firstName.charAt(0)}${contact.lastName.charAt(0)}`.toUpperCase()
  const [editing, setEditing] = useState(false)
  const [firstName, setFirstName] = useState(contact.firstName)
  const [lastName, setLastName] = useState(contact.lastName)
  const [saving, setSaving] = useState(false)

  const handleSaveName = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('Name fields are required')
      return
    }
    setSaving(true)
    try {
      await updateContact(contact.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      } as any)
      onSave('firstName', firstName.trim())
      onSave('lastName', lastName.trim())
      toast.success('Name updated')
      setEditing(false)
    } catch {
      toast.error('Failed to update name')
    } finally {
      setSaving(false)
    }
  }, [contact.id, firstName, lastName, onSave])

  const fullName = `${contact.firstName} ${contact.lastName}`

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        <div className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-2xl font-bold text-white shadow-sm">
          {initials}
          <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-9 rounded-md border border-slate-300 px-3 text-lg font-semibold focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="First name"
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-9 rounded-md border border-slate-300 px-3 text-lg font-semibold focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="Last name"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={handleSaveName}
                  disabled={saving}
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{fullName}</h1>
          )}
          {contact.jobTitle ? (
            <p className="mt-0.5 text-base text-slate-600">
              {contact.jobTitle}
              {contact.company ? <span> at {contact.company}</span> : null}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              <a href={`mailto:${contact.email}`} className="text-indigo-600 hover:underline">
                {contact.email}
              </a>
            </span>
            {contact.phone ? (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                {contact.phone}
              </span>
            ) : null}
            {contact.owner ? (
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-slate-400" />
                Owner:{' '}
                <span className="text-indigo-600">
                  {contact.owner.firstName} {contact.owner.lastName}
                </span>
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              Updated {new Date(contact.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => setEditing(!editing)}
          >
            <Pencil className="h-3.5 w-3.5" />
            {editing ? 'Cancel' : 'Edit name'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => toast.success('Share feature coming soon')}
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => toast.success('More actions coming soon')}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail Row ───────────────────────────────────────
function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="group flex items-start gap-4 border-b border-slate-100 px-6 py-3.5 last:border-b-0">
      <span className="w-[110px] shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
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
    <div className="space-y-3 px-6 py-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags && tags.length > 0 ? (
          tags.map((t) => <TagBadge key={t.id} tag={t} onRemove={handleRemoveTag} />)
        ) : (
          <span className="text-sm italic text-slate-300">No tags</span>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-indigo-400 hover:text-indigo-600"
          onClick={() => setShowSelector(!showSelector)}
        >
          <Plus className="h-3 w-3" />
          {showSelector ? 'Cancel' : 'Add tag'}
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
    </div>
  )
}

// ─── Quick Info Card ──────────────────────────────────
function QuickInfoCard({ contact }: { contact: Contact }): React.JSX.Element {
  const items = [
    {
      label: 'Owner',
      value: contact.owner ? `${contact.owner.firstName} ${contact.owner.lastName}` : '—',
    },
    { label: 'Created', value: new Date(contact.createdAt).toLocaleDateString() },
    { label: 'Updated', value: new Date(contact.updatedAt).toLocaleDateString() },
    { label: 'Sharing', value: 'Not shared', highlight: true },
  ]
  return (
    <Card>
      <CardHeader className="border-b border-slate-100 px-5 py-3.5">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Clock className="h-4 w-4 text-slate-400" />
          Quick Info
        </CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
        {items.map((item) => (
          <div key={item.label} className="px-5 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {item.label}
            </p>
            <p
              className={cn(
                'mt-0.5 text-sm font-medium',
                item.highlight ? 'text-emerald-600' : 'text-slate-900',
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── Channels ─────────────────────────────────────────
function ChannelsCard(): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="border-b border-slate-100 px-5 py-3.5">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Globe className="h-4 w-4 text-slate-400" />
          Connected Channels
        </CardTitle>
      </CardHeader>
      <div className="flex flex-wrap gap-2 px-5 py-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
          <MessageSquare className="h-3.5 w-3.5" />
          Facebook
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
          <Mail className="h-3.5 w-3.5" />
          Email
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-400 transition-colors hover:border-indigo-400 hover:text-indigo-600"
          onClick={() => toast.success('Connect channel feature coming soon')}
        >
          <Plus className="h-3 w-3" />
          Connect
        </button>
      </div>
    </Card>
  )
}

// ─── Enrichment Progress ──────────────────────────────
function EnrichmentProgress({ contact }: { contact: Contact }): React.JSX.Element {
  const enrichmentFields = [
    contact.linkedin,
    contact.twitter,
    contact.addressStreet,
    contact.addressCity,
    contact.addressCountry,
    contact.department,
    contact.timezone,
    contact.language,
    contact.source,
    contact.notes,
  ]
  const filled = enrichmentFields.filter(Boolean).length
  const total = enrichmentFields.length
  const pct = Math.round((filled / total) * 100)

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white">
      <CardHeader className="border-b border-indigo-100 px-5 py-3.5">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-indigo-700">
          <CheckCircle2 className="h-4 w-4" />
          Enrichment Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Profile completeness</span>
          <span className="font-semibold text-indigo-600">{pct}%</span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-3 flex gap-4 text-xs">
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <Circle className="h-2 w-2 fill-emerald-500" />
            {filled} filled
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Circle className="h-2 w-2 fill-slate-300" />
            {total - filled} missing
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Activity Timeline ────────────────────────────────
function ActivityTimeline(): React.JSX.Element {
  return (
    <div className="space-y-0">
      {ACTIVITIES.map((a, i) => (
        <div key={i} className="relative flex gap-4 px-6 py-4">
          {i < ACTIVITIES.length - 1 ? (
            <div className="absolute left-[35px] top-[52px] bottom-0 w-px bg-slate-200" />
          ) : null}
          <div
            className={cn(
              'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              a.color,
            )}
          >
            <a.icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">
              {a.headline}
              {a.detail ? (
                <span className="block mt-1 text-sm font-normal text-slate-600">{a.detail}</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">{a.time}</p>
          </div>
        </div>
      ))}
      <div className="border-t border-slate-100 px-6 py-4 text-xs text-slate-400 italic">
        Activity log is read-only in this view
      </div>
    </div>
  )
}

// ─── Conversations ────────────────────────────────────
function ConversationList(): React.JSX.Element {
  return (
    <div className="divide-y divide-slate-100">
      {CONVERSATIONS.map((conv, i) => (
        <div
          key={i}
          className="flex cursor-pointer items-center gap-4 px-6 py-4 transition-colors hover:bg-slate-50"
          onClick={() => toast.success('Open conversation coming soon')}
        >
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              conv.channelColor,
            )}
          >
            <conv.channelIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">{conv.title}</p>
            <p className="text-xs text-slate-400">
              {conv.channel} · Last message: {conv.lastMessage}
              {conv.messageCount ? ` · ${conv.messageCount}` : null}
            </p>
          </div>
          <Badge
            variant={
              conv.status === 'Open'
                ? 'warning'
                : conv.status === 'Resolved'
                  ? 'success'
                  : 'neutral'
            }
            className="shrink-0 text-[11px]"
          >
            {conv.status}
          </Badge>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────
export function ContactDetailClient({ contact }: { contact: Contact }): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [localContact, setLocalContact] = useState(contact)
  const [, setRefreshKey] = useState(0)

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
    <div className="space-y-5">
      <ProfileHeader contact={localContact} onSave={handleEnrichSave} />

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-all',
                isActive
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800',
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.badge ? (
                <span
                  className={cn(
                    'ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500',
                  )}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            {/* Contact Information — tất cả field đều inline-editable */}
            <Card>
              <CardHeader className="border-b border-slate-100 px-6 py-3.5">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <User className="h-4 w-4 text-slate-400" />
                  Contact Information
                </CardTitle>
              </CardHeader>
              <div className="divide-y divide-slate-100">
                <DetailRow label="Email">
                  <InlineEditField
                    label="Email"
                    value={localContact.email}
                    fieldKey="email"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Phone">
                  <InlineEditField
                    label="Phone"
                    value={localContact.phone}
                    fieldKey="phone"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Company">
                  <InlineEditField
                    label="Company"
                    value={localContact.company}
                    fieldKey="company"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Job Title">
                  <InlineEditField
                    label="Job Title"
                    value={localContact.jobTitle}
                    fieldKey="jobTitle"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Department">
                  <InlineEditField
                    label="Department"
                    value={localContact.department}
                    fieldKey="department"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
              </div>
            </Card>

            {/* Enriched Information */}
            <Card>
              <CardHeader className="border-b border-slate-100 px-6 py-3.5">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Globe className="h-4 w-4 text-slate-400" />
                  Enriched Information
                </CardTitle>
              </CardHeader>
              <div className="divide-y divide-slate-100">
                <DetailRow label="LinkedIn">
                  <InlineEditField
                    label="LinkedIn"
                    value={localContact.linkedin}
                    fieldKey="linkedin"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Twitter / X">
                  <InlineEditField
                    label="Twitter"
                    value={localContact.twitter}
                    fieldKey="twitter"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Address">
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
                </DetailRow>
                <DetailRow label="Timezone">
                  <InlineEditField
                    label="Timezone"
                    value={localContact.timezone}
                    fieldKey="timezone"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Language">
                  <InlineEditField
                    label="Language"
                    value={localContact.language}
                    fieldKey="language"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Source">
                  <InlineEditField
                    label="Source"
                    value={localContact.source}
                    fieldKey="source"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                  />
                </DetailRow>
                <DetailRow label="Notes">
                  <InlineEditField
                    label="Notes"
                    value={localContact.notes}
                    fieldKey="notes"
                    contactId={localContact.id}
                    onSave={handleEnrichSave}
                    multiline
                  />
                </DetailRow>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <OwnerSection
              contactId={localContact.id}
              ownerId={localContact.ownerId}
              owner={localContact.owner}
              canUpdate={true}
              onAssignOwner={handleAssignOwner}
            />
            <QuickInfoCard contact={localContact} />
            <Card>
              <CardHeader className="border-b border-slate-100 px-5 py-3.5">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CheckCircle2 className="h-4 w-4 text-slate-400" />
                  Tags
                </CardTitle>
              </CardHeader>
              <TagsSection
                contactId={localContact.id}
                tags={localContact.tags}
                onTagsChange={refreshContact}
              />
            </Card>
            <ChannelsCard />
            <EnrichmentProgress contact={localContact} />
          </div>
        </div>
      ) : null}

      {/* ── Activity Tab ── */}
      {activeTab === 'activity' ? (
        <Card>
          <CardHeader className="border-b border-slate-100 px-6 py-3.5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Clock className="h-4 w-4 text-slate-400" />
              Activity Timeline
            </CardTitle>
          </CardHeader>
          <ActivityTimeline />
        </Card>
      ) : null}

      {/* ── Conversations Tab ── */}
      {activeTab === 'conversations' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 px-6 py-3.5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MessageSquare className="h-4 w-4 text-slate-400" />
              Conversations
            </CardTitle>
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1.5 bg-indigo-600 text-xs hover:bg-indigo-700"
              onClick={() => toast.success('New conversation feature coming soon')}
            >
              <Plus className="h-3 w-3" />
              New conversation
            </Button>
          </CardHeader>
          <ConversationList />
        </Card>
      ) : null}
    </div>
  )
}
