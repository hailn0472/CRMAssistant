'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { TagSelector } from '@/components/contacts/TagSelector'
import { createContact, updateContact } from '@/services/contact.service'
import { addTagToContact } from '@/services/tag.service'
import { searchUsers } from '@/services/owner.service'
import { cn } from '@/lib/utils'
import type { Contact, ContactFormData } from '@/services/contact.service'

type TagShape = { id: string; name: string; color: string }

// Kept local so the form remains isolated when the request service is mocked.
const LEAD_STATUS_VALUES = [
  'NEW',
  'REVIEWING',
  'NURTURING',
  'QUALIFIED_LEAD',
  'NOT_A_LEAD',
] as const

const contactSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  phone: z.string().trim().optional(),
  company: z.string().trim().optional(),
  jobTitle: z.string().trim().optional(),
  ownerId: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  leadStatus: z.enum(LEAD_STATUS_VALUES).optional(),
  leadScore: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) =>
        !value || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100),
      'Lead score must be between 0 and 100',
    ),
  qualificationReason: z
    .string()
    .trim()
    .max(2000, 'Keep the reason under 2,000 characters')
    .optional(),
})

function optionalString(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  return value.trim() || null
}

type ContactFormValues = z.infer<typeof contactSchema>

type ContactFormProps = {
  contact?: Contact
  /** Called instead of navigating away — used by the slide-over. */
  onSaved?: (contact: Contact) => void
  onCancel?: () => void
}

const inputClass =
  'h-[38px] w-full rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13.5px] text-[#1b1b1f] outline-none transition-colors placeholder:text-[#9b9ba3] focus:border-[#1b1b1f] focus:bg-white'

export function ContactForm({ contact, onSaved, onCancel }: ContactFormProps): React.JSX.Element {
  const router = useRouter()
  const [selectedTags, setSelectedTags] = useState<TagShape[]>(contact?.tags ?? [])
  const [contactId] = useState<string | null>(contact?.id ?? null)
  const pendingTagsRef = useRef<TagShape[]>([])

  const { data: owners = [] } = useQuery({
    queryKey: ['contact-form-owners'],
    queryFn: () => searchUsers(''),
  })

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      email: contact?.email ?? '',
      firstName: contact?.firstName ?? '',
      lastName: contact?.lastName ?? '',
      phone: contact?.phone ?? '',
      company: contact?.company ?? '',
      jobTitle: contact?.jobTitle ?? '',
      ownerId: contact?.ownerId ?? '',
      notes: contact?.notes ?? '',
      leadStatus: contact?.leadStatus ?? 'NEW',
      leadScore: contact?.leadScore?.toString() ?? '',
      qualificationReason: contact?.qualificationReason ?? '',
    },
  })

  async function onSubmit(values: ContactFormValues): Promise<void> {
    try {
      const payload: ContactFormData = {
        email: values.email.trim(),
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: optionalString(values.phone),
        company: optionalString(values.company),
        jobTitle: optionalString(values.jobTitle),
        notes: optionalString(values.notes),
      }
      // Owner is only settable at creation; existing contacts are reassigned
      // through the dedicated owner picker on the detail page.
      if (!contact && values.ownerId) {
        payload.ownerId = values.ownerId
      }
      if (contact) {
        payload.leadStatus = values.leadStatus
        payload.leadScore = values.leadScore?.trim() ? Number(values.leadScore) : null
        payload.qualificationReason = optionalString(values.qualificationReason)
      }
      const savedContact = contact
        ? await updateContact(contact.id, payload)
        : await createContact(payload)
      // If this was a new contact, assign any pending tags
      if (!contact && pendingTagsRef.current.length > 0) {
        await Promise.all(
          pendingTagsRef.current.map((tag) => addTagToContact(savedContact.id, tag.id)),
        )
      }
      if (onSaved) {
        onSaved(savedContact)
        return
      }
      router.push(`/contacts/${savedContact.id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to save contact',
      })
    }
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit(onSubmit)}>
      <div className="flex min-h-0 flex-1 flex-col gap-[26px] overflow-y-auto px-6 py-[22px]">
        <Section title="Identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" required error={errors.firstName?.message}>
              <input
                className={inputClass}
                placeholder="Dana"
                {...register('firstName')}
                aria-invalid={Boolean(errors.firstName)}
              />
            </Field>
            <Field label="Last name" required error={errors.lastName?.message}>
              <input
                className={inputClass}
                placeholder="Whitfield"
                {...register('lastName')}
                aria-invalid={Boolean(errors.lastName)}
              />
            </Field>
          </div>
        </Section>

        <Section title="How to reach them">
          <Field label="Email" required error={errors.email?.message}>
            <input
              className={inputClass}
              type="email"
              placeholder="dana@northwind.co"
              {...register('email')}
              aria-invalid={Boolean(errors.email)}
            />
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            <input
              className={inputClass}
              placeholder="912 345 678"
              {...register('phone')}
              aria-invalid={Boolean(errors.phone)}
            />
          </Field>
        </Section>

        <Section title="Work">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company" error={errors.company?.message}>
              <input
                className={inputClass}
                placeholder="Northwind"
                {...register('company')}
                aria-invalid={Boolean(errors.company)}
              />
            </Field>
            <Field label="Job title" error={errors.jobTitle?.message}>
              <input
                className={inputClass}
                placeholder="VP Operations"
                {...register('jobTitle')}
                aria-invalid={Boolean(errors.jobTitle)}
              />
            </Field>
          </div>
          {contact ? null : (
            <Field label="Owner" error={errors.ownerId?.message}>
              <select className={cn(inputClass, 'cursor-pointer')} {...register('ownerId')}>
                <option value="">Assign to me</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {`${owner.firstName} ${owner.lastName}`.trim() || owner.email}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Section>

        <Section title="Tags" hint="Tags drive segment filters and automations.">
          <TagSelector
            contactId={contactId}
            selectedTags={selectedTags}
            onTagsChange={(tags) => {
              setSelectedTags(tags)
              pendingTagsRef.current = tags
            }}
          />
        </Section>

        {contact ? (
          <Section
            title="Lead qualification"
            hint="Use this to assess the contact independently from deals."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status" error={errors.leadStatus?.message}>
                <select className={cn(inputClass, 'cursor-pointer')} {...register('leadStatus')}>
                  <option value="NEW">New</option>
                  <option value="REVIEWING">Reviewing</option>
                  <option value="NURTURING">Nurturing</option>
                  <option value="QUALIFIED_LEAD">Qualified lead</option>
                  <option value="NOT_A_LEAD">Not a lead</option>
                </select>
              </Field>
              <Field label="Lead score (0–100)" error={errors.leadScore?.message}>
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="e.g. 75"
                  {...register('leadScore')}
                  aria-invalid={Boolean(errors.leadScore)}
                />
              </Field>
            </div>
            <Field label="Decision rationale" error={errors.qualificationReason?.message}>
              <textarea
                rows={3}
                placeholder="Why this contact is or is not a qualified lead…"
                className="w-full resize-y rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 py-2.5 text-[13.5px] text-[#1b1b1f] outline-none transition-colors placeholder:text-[#9b9ba3] focus:border-[#1b1b1f] focus:bg-white"
                {...register('qualificationReason')}
              />
            </Field>
          </Section>
        ) : null}

        <Field label="Note" error={errors.notes?.message}>
          <textarea
            rows={3}
            placeholder="Context from the first conversation…"
            className="w-full resize-y rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 py-2.5 text-[13.5px] text-[#1b1b1f] outline-none transition-colors placeholder:text-[#9b9ba3] focus:border-[#1b1b1f] focus:bg-white"
            {...register('notes')}
          />
        </Field>

        {errors.root?.message ? (
          <p
            className="rounded-[9px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
            role="alert"
          >
            {errors.root.message}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[#f0f0f4] bg-white px-6 py-[16px]">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-[36px] items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-[36px] items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
        >
          {isSubmitting ? 'Saving...' : 'Save contact'}
        </button>
      </div>
    </form>
  )
}

type SectionProps = {
  title: string
  hint?: string
  children: React.ReactNode
}

function Section({ title, hint, children }: SectionProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#a0a0aa]">
        {title}
      </div>
      {children}
      {hint ? <span className="text-[11.5px] text-[#8c8c96]">{hint}</span> : null}
    </div>
  )
}

type FieldProps = {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}

function Field({ label, required, error, children }: FieldProps): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-[#4b4b55]">
        {label}
        {required ? <span className="text-[#b91c1c]"> *</span> : null}
      </span>
      {children}
      {error ? (
        <span className="text-[11.5px] font-medium text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
