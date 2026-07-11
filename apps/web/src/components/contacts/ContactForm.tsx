'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useRef, useState } from 'react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { TagSelector } from '@/components/contacts/TagSelector'
import { createContact, updateContact } from '@/services/contact.service'
import { addTagToContact } from '@/services/tag.service'
import type { Contact, ContactFormData } from '@/services/contact.service'

type TagShape = { id: string; name: string; color: string }

const contactSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  phone: z.string().trim().optional(),
  company: z.string().trim().optional(),
  jobTitle: z.string().trim().optional(),
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
}

export function ContactForm({ contact }: ContactFormProps): React.JSX.Element {
  const router = useRouter()
  const [selectedTags, setSelectedTags] = useState<TagShape[]>(contact?.tags ?? [])
  const [contactId, setContactId] = useState<string | null>(contact?.id ?? null)
  const pendingTagsRef = useRef<TagShape[]>([])
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
      router.push(`/contacts/${savedContact.id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to save contact',
      })
    }
  }

  return (
    <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="text-lg">{contact ? 'Edit contact' : 'Contact details'}</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <Field label="Email" error={errors.email?.message}>
            <Input type="email" {...register('email')} aria-invalid={Boolean(errors.email)} />
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            <Input {...register('phone')} aria-invalid={Boolean(errors.phone)} />
          </Field>
          <Field label="First name" error={errors.firstName?.message}>
            <Input {...register('firstName')} aria-invalid={Boolean(errors.firstName)} />
          </Field>
          <Field label="Last name" error={errors.lastName?.message}>
            <Input {...register('lastName')} aria-invalid={Boolean(errors.lastName)} />
          </Field>
          <Field label="Company" error={errors.company?.message}>
            <Input {...register('company')} aria-invalid={Boolean(errors.company)} />
          </Field>
          <Field label="Job title" error={errors.jobTitle?.message}>
            <Input {...register('jobTitle')} aria-invalid={Boolean(errors.jobTitle)} />
          </Field>

          <div className="md:col-span-2">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Tags
              <TagSelector
                contactId={contactId}
                selectedTags={selectedTags}
                onTagsChange={(tags) => {
                  setSelectedTags(tags)
                  pendingTagsRef.current = tags
                }}
              />
            </label>
          </div>

          {errors.root?.message ? (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-2"
              role="alert"
            >
              {errors.root.message}
            </p>
          ) : null}

          <div className="flex items-center justify-end border-t border-slate-100 pt-5 md:col-span-2">
            <Button
              disabled={isSubmitting}
              type="submit"
              className="bg-slate-950 text-white hover:bg-slate-800"
            >
              {isSubmitting ? 'Saving...' : 'Save contact'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

type FieldProps = {
  label: string
  error?: string
  children: React.ReactNode
}

function Field({ label, error, children }: FieldProps): React.JSX.Element {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      {children}
      {error ? (
        <span className="text-xs font-medium text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
