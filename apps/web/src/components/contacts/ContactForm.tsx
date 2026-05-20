'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  createContact,
  updateContact,
  type Contact,
  type ContactFormData,
} from '@/services/contact.service'

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
      router.push(`/contacts/${savedContact.id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to save contact',
      })
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.07] text-white">
      <CardHeader>
        <CardTitle>{contact ? 'Edit contact' : 'Create contact'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
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

          {errors.root?.message ? (
            <p className="md:col-span-2 text-sm text-red-300" role="alert">
              {errors.root.message}
            </p>
          ) : null}

          <div className="md:col-span-2">
            <Button disabled={isSubmitting} type="submit">
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
    <label className="grid gap-2 text-sm font-medium text-slate-200">
      {label}
      {children}
      {error ? (
        <span className="text-xs text-red-300" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
