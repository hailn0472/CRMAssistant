'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { createDeal, updateDeal, getDealStages } from '@/services/deal.service'
import { getContacts } from '@/services/contact.service'
import { getDealLineItems } from '@/services/product.service'
import { searchUsers } from '@/services/owner.service'
import { cn } from '@/lib/utils'
import type { Deal } from '@/services/deal.service'

const dealSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  value: z.coerce.number().min(0, 'Value must be 0 or greater').default(0),
  currency: z.string().trim().default('USD'),
  stageId: z.string().min(1, 'Stage is required'),
  contactId: z.string().min(1, 'Contact is required'),
  ownerId: z.string().trim().optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().optional(),
})

type DealFormValues = z.infer<typeof dealSchema>

type DealFormProps = {
  deal?: Deal
  onSaved?: (deal: Deal) => void
  onCancel?: () => void
}

const inputClass =
  'h-[38px] w-full rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13.5px] text-[#1b1b1f] outline-none transition-colors placeholder:text-[#9b9ba3] focus:border-[#1b1b1f] focus:bg-white'

export function DealForm({ deal, onSaved, onCancel }: DealFormProps): React.JSX.Element {
  const router = useRouter()
  const [contactSearch, setContactSearch] = useState(
    deal?.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : '',
  )
  const [showContactDropdown, setShowContactDropdown] = useState(false)

  const { data: stages } = useQuery({
    queryKey: ['dealStages'],
    queryFn: getDealStages,
  })

  const { data: dealLineItems } = useQuery({
    queryKey: ['dealLineItems', deal?.id],
    queryFn: () => getDealLineItems(deal!.id),
    enabled: Boolean(deal?.id),
  })

  const hasLineItems = dealLineItems && dealLineItems.length > 0

  const { data: contactsData } = useQuery({
    queryKey: ['contacts', 'search', contactSearch],
    queryFn: () => getContacts(1, 20, { search: contactSearch || undefined }),
    enabled: showContactDropdown,
  })

  const { data: owners = [] } = useQuery({
    queryKey: ['deal-form-owners'],
    queryFn: () => searchUsers(''),
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
      ownerId: deal?.ownerId ?? '',
      probability: deal?.probability ?? undefined,
      expectedCloseDate: deal?.expectedCloseDate
        ? new Date(deal.expectedCloseDate).toISOString().split('T')[0]
        : '',
    },
  })

  const selectedContactId = watch('contactId')
  const selectedStageId = watch('stageId')
  const selectedStage = stages?.find((stage) => stage.id === selectedStageId)

  async function onSubmit(values: DealFormValues): Promise<void> {
    try {
      const payload = {
        title: values.title.trim(),
        value: hasLineItems ? undefined : values.value,
        currency: values.currency || 'USD',
        stageId: values.stageId,
        contactId: values.contactId,
        ownerId: values.ownerId || undefined,
        probability: values.probability ?? undefined,
        expectedCloseDate: values.expectedCloseDate || undefined,
      }
      const savedDeal = deal ? await updateDeal(deal.id, payload) : await createDeal(payload)

      if (onSaved) {
        onSaved(savedDeal)
        return
      }
      router.push(`/deals/${savedDeal.id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to save deal',
      })
    }
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit(onSubmit)}>
      <div className="flex min-h-0 flex-1 flex-col gap-[24px] overflow-y-auto px-6 py-[22px]">
        <Section title="Deal">
          <Field label="Title" required error={errors.title?.message}>
            <input
              className={inputClass}
              placeholder="Enter deal title"
              {...register('title')}
              aria-invalid={Boolean(errors.title)}
            />
          </Field>

          <div className="grid grid-cols-[1.4fr_1fr] gap-3">
            <Field label="Value" error={errors.value?.message}>
              <div
                className={cn(
                  'flex h-[38px] items-center gap-[7px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 transition-colors focus-within:border-[#1b1b1f] focus-within:bg-white',
                  hasLineItems && 'bg-[#f0f0f3]',
                )}
              >
                <span className="text-[13px] text-[#a0a0aa]">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  {...register('value')}
                  readOnly={hasLineItems}
                  aria-invalid={Boolean(errors.value)}
                  className={cn(
                    'min-w-0 flex-1 border-none bg-transparent font-mono text-[13.5px] text-[#1b1b1f] outline-none',
                    hasLineItems && 'cursor-not-allowed text-[#8c8c96]',
                  )}
                />
              </div>
              {hasLineItems && (
                <span className="text-[11.5px] italic text-[#8c8c96]">
                  Value is calculated from the deal&apos;s products.
                </span>
              )}
            </Field>

            <Field label="Currency" error={errors.currency?.message}>
              <select
                {...register('currency')}
                className={cn(inputClass, 'cursor-pointer')}
                aria-invalid={Boolean(errors.currency)}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="VND">VND</option>
              </select>
            </Field>
          </div>
        </Section>

        <div className="flex flex-col gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#a0a0aa]">
            Stage <span className="text-[#b91c1c]">*</span>
          </div>
          <div className="flex flex-wrap gap-[7px]">
            {stages?.map((stage) => {
              const isSelected = stage.id === selectedStageId
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => setValue('stageId', stage.id, { shouldValidate: true })}
                  className={cn(
                    'flex h-8 items-center gap-[7px] rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                    isSelected
                      ? 'border-[#1b1b1f] bg-[#fafafb] text-[#1b1b1f]'
                      : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:border-[#c7c7d1]',
                  )}
                >
                  <span
                    className="block h-[5px] w-[5px] shrink-0 rounded-full"
                    style={{ background: stage.color }}
                  />
                  {stage.name}
                </button>
              )
            })}
          </div>
          {errors.stageId?.message ? (
            <span className="text-[11.5px] font-medium text-[#b91c1c]" role="alert">
              {errors.stageId.message}
            </span>
          ) : null}

          <Field label="Probability" error={errors.probability?.message}>
            <div className="flex h-[38px] max-w-[240px] items-center gap-[7px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 transition-colors focus-within:border-[#1b1b1f] focus-within:bg-white">
              <input
                type="number"
                min="0"
                max="100"
                placeholder="Inherit stage default"
                {...register('probability')}
                aria-invalid={Boolean(errors.probability)}
                className="min-w-0 flex-1 border-none bg-transparent font-mono text-[13.5px] text-[#1b1b1f] outline-none"
              />
              <span className="text-[13px] text-[#a0a0aa]">%</span>
            </div>
            <span className="text-[11.5px] text-[#a0a0aa]">
              {selectedStage
                ? `Default for ${selectedStage.name} — override if you disagree.`
                : 'Default comes from the selected stage.'}
            </span>
          </Field>
        </div>

        <Section title="People & timeline">
          <Field label="Primary contact" required error={errors.contactId?.message}>
            <div className="relative">
              <div className="flex h-[38px] items-center gap-[9px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-[11px] transition-colors focus-within:border-[#1b1b1f] focus-within:bg-white">
                {selectedContactId ? (
                  <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[#f0f0f3] text-[9.5px] font-semibold text-[#4b4b55]">
                    {contactSearch
                      .trim()
                      .split(/\s+/)
                      .map((part) => part.charAt(0))
                      .join('')
                      .slice(0, 2)
                      .toUpperCase() || '?'}
                  </span>
                ) : null}
                <input
                  className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-[#1b1b1f] outline-none"
                  placeholder="Search contacts..."
                  value={contactSearch}
                  onChange={(e) => {
                    setContactSearch(e.target.value)
                    setValue('contactId', '', { shouldValidate: false })
                    setShowContactDropdown(true)
                  }}
                  onFocus={() => setShowContactDropdown(true)}
                />
              </div>
              {showContactDropdown && contactsData && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[9px] border border-[#e6e6eb] bg-white shadow-lg">
                  {contactsData.items.length === 0 ? (
                    <div className="px-3 py-2 text-[13px] text-[#8c8c96]">No contacts found</div>
                  ) : (
                    contactsData.items.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        className={`w-full px-3 py-2 text-left text-[13px] hover:bg-[#f4f4f6] ${
                          selectedContactId === contact.id
                            ? 'bg-[#f4f4f6] font-medium text-[#1b1b1f]'
                            : 'text-[#4b4b55]'
                        }`}
                        onClick={() => {
                          setValue('contactId', contact.id, { shouldValidate: true })
                          setContactSearch(`${contact.firstName} ${contact.lastName}`)
                          setShowContactDropdown(false)
                        }}
                      >
                        {contact.firstName} {contact.lastName}
                        <span className="ml-2 text-[12px] text-[#8c8c96]">{contact.email}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <input type="hidden" {...register('contactId')} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Owner" error={errors.ownerId?.message}>
              <select
                {...register('ownerId')}
                className={cn(inputClass, 'cursor-pointer')}
                aria-invalid={Boolean(errors.ownerId)}
              >
                <option value="">Assign to me</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {`${owner.firstName} ${owner.lastName}`.trim() || owner.email}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Expected close" error={errors.expectedCloseDate?.message}>
              <input type="date" className={inputClass} {...register('expectedCloseDate')} />
            </Field>
          </div>
        </Section>

        {errors.root?.message ? (
          <p
            className="rounded-[9px] border border-[#f0d5d5] bg-[#fdf2f2] px-3 py-2 text-[13px] text-[#b91c1c]"
            role="alert"
          >
            {errors.root.message}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[#f2f2f5] bg-[#fafafb] px-6 py-[14px]">
        <span className="text-[12px] text-[#a0a0aa]">
          {deal ? `Last updated ${new Date(deal.updatedAt).toLocaleDateString()}` : ''}
        </span>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-9 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {isSubmitting ? 'Saving...' : deal ? 'Update deal' : 'Save deal'}
          </button>
        </div>
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
        <span className="text-[11.5px] font-medium text-[#b91c1c]" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
