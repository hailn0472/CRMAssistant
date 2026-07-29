'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createDeal, updateDeal, getDealStages } from '@/services/deal.service'
import { getContacts } from '@/services/contact.service'
import type { Deal } from '@/services/deal.service'

const dealSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  value: z.coerce.number().min(0, 'Value must be 0 or greater').default(0),
  currency: z.string().trim().default('USD'),
  stageId: z.string().min(1, 'Stage is required'),
  contactId: z.string().min(1, 'Contact is required'),
  expectedCloseDate: z.string().optional(),
})

type DealFormValues = z.infer<typeof dealSchema>

type DealFormProps = {
  deal?: Deal
}

export function DealForm({ deal }: DealFormProps): React.JSX.Element {
  const router = useRouter()
  const [contactSearch, setContactSearch] = useState('')
  const [showContactDropdown, setShowContactDropdown] = useState(false)

  const { data: stages } = useQuery({
    queryKey: ['dealStages'],
    queryFn: getDealStages,
  })

  const { data: contactsData } = useQuery({
    queryKey: ['contacts', 'search', contactSearch],
    queryFn: () => getContacts(1, 20, { search: contactSearch || undefined }),
    enabled: showContactDropdown,
  })

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema) as any,
    defaultValues: {
      title: deal?.title ?? '',
      value: deal?.value ?? 0,
      currency: deal?.currency ?? 'USD',
      stageId: deal?.stageId ?? '',
      contactId: deal?.contactId ?? '',
      expectedCloseDate: deal?.expectedCloseDate
        ? new Date(deal.expectedCloseDate).toISOString().split('T')[0]
        : '',
    },
  })

  const selectedContactId = watch('contactId')

  async function onSubmit(values: DealFormValues): Promise<void> {
    try {
      const payload = {
        title: values.title.trim(),
        value: values.value,
        currency: values.currency || 'USD',
        stageId: values.stageId,
        contactId: values.contactId,
        expectedCloseDate: values.expectedCloseDate || undefined,
      }
      const savedDeal = deal ? await updateDeal(deal.id, payload) : await createDeal(payload)

      router.push(`/deals/${savedDeal.id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to save deal',
      })
    }
  }

  return (
    <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="text-lg">{deal ? 'Edit deal' : 'Create deal'}</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <Field label="Title" error={errors.title?.message}>
            <Input
              {...register('title')}
              aria-invalid={Boolean(errors.title)}
              placeholder="Enter deal title"
            />
          </Field>

          <Field label="Value" error={errors.value?.message}>
            <Input
              type="number"
              min="0"
              step="0.01"
              {...register('value')}
              aria-invalid={Boolean(errors.value)}
            />
          </Field>

          <Field label="Currency" error={errors.currency?.message}>
            <Input
              {...register('currency')}
              placeholder="USD"
              aria-invalid={Boolean(errors.currency)}
            />
          </Field>

          <Field label="Stage" error={errors.stageId?.message}>
            <select
              {...register('stageId')}
              className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              aria-invalid={Boolean(errors.stageId)}
            >
              <option value="">Select stage</option>
              {stages?.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Contact" error={errors.contactId?.message}>
            <div className="relative">
              <Input
                placeholder="Search contacts..."
                value={contactSearch}
                onChange={(e) => {
                  setContactSearch(e.target.value)
                  setShowContactDropdown(true)
                }}
                onFocus={() => setShowContactDropdown(true)}
              />
              {showContactDropdown && contactsData && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {contactsData.items.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-500">No contacts found</div>
                  ) : (
                    contactsData.items.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
                          selectedContactId === contact.id ? 'bg-indigo-50 font-medium' : ''
                        }`}
                        onClick={() => {
                          setValue('contactId', contact.id, { shouldValidate: true })
                          setContactSearch(`${contact.firstName} ${contact.lastName}`)
                          setShowContactDropdown(false)
                        }}
                      >
                        {contact.firstName} {contact.lastName}
                        <span className="ml-2 text-xs text-slate-400">{contact.email}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {selectedContactId && !showContactDropdown ? null : null}
            </div>
            <input type="hidden" {...register('contactId')} />
          </Field>

          <Field label="Expected close date" error={errors.expectedCloseDate?.message}>
            <Input type="date" {...register('expectedCloseDate')} />
          </Field>

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
              {isSubmitting ? 'Saving...' : deal ? 'Update deal' : 'Create deal'}
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
