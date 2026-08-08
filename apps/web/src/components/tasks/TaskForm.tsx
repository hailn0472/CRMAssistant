'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  createTask,
  updateTask,
  createTaskFromTemplate,
  getTaskTemplates,
} from '@/services/task.service'
import { getContact, getContacts } from '@/services/contact.service'
import { getDeals } from '@/services/deal.service'
import { searchUsers } from '@/services/owner.service'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_RECURRENCE_PATTERNS,
  TASK_RECURRENCE_PATTERN_LABELS,
} from '@/lib/task-format'
import { cn } from '@/lib/utils'
import type { Task } from '@/services/task.service'

const taskSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required'),
    description: z.string().optional(),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    dueDate: z.string().optional(),
    assignedTo: z.string().optional(),
    contactId: z.string().optional(),
    dealId: z.string().optional(),
    // Story 4.6 (AC 64-67): recurrence fields
    isRecurring: z.boolean().optional().default(false),
    recurrencePattern: z.string().optional(),
    recurrenceEndDate: z.string().optional(),
  })
  .refine(
    (data) =>
      !data.isRecurring ||
      (data.isRecurring && data.recurrencePattern && data.recurrencePattern.length > 0),
    {
      message: 'Recurrence pattern is required when task is recurring',
      path: ['recurrencePattern'],
    },
  )
  .refine(
    (data) => !data.recurrenceEndDate || !data.dueDate || data.recurrenceEndDate >= data.dueDate,
    {
      message: 'Recurrence end date must be on or after the due date',
      path: ['recurrenceEndDate'],
    },
  )

type TaskFormValues = z.infer<typeof taskSchema>

type TaskFormProps = {
  task?: Task
  /** Overrides the ?fromTemplate=1 search param — used when rendered in a drawer. */
  fromTemplate?: boolean
  /** Overrides the ?contactId= search param — used when rendered in a drawer
   * (e.g. Inbox's "New task" action prefilling the current conversation's contact). */
  initialContactId?: string
  onSaved?: (task: Task) => void
  onCancel?: () => void
}

const inputClass =
  'h-[38px] w-full rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13.5px] text-[#1b1b1f] outline-none transition-colors placeholder:text-[#9b9ba3] focus:border-[#1b1b1f] focus:bg-white'

export function TaskForm({
  task,
  fromTemplate,
  initialContactId,
  onSaved,
  onCancel,
}: TaskFormProps): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isFromTemplate = fromTemplate ?? searchParams.get('fromTemplate') === '1'
  const prefillContactId = task ? undefined : initialContactId ?? searchParams.get('contactId')

  const [contactSearch, setContactSearch] = useState('')
  const [showContactDropdown, setShowContactDropdown] = useState(false)
  const [dealSearch, setDealSearch] = useState('')
  const [showDealDropdown, setShowDealDropdown] = useState(false)
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false)
  const [templateId, setTemplateId] = useState('')

  const { data: templates } = useQuery({
    queryKey: ['taskTemplates'],
    queryFn: () => getTaskTemplates(1, 100),
    enabled: isFromTemplate && !task,
  })

  const { data: contactsData } = useQuery({
    queryKey: ['contacts', 'search', contactSearch],
    queryFn: () => getContacts(1, 20, { search: contactSearch || undefined }),
    enabled: showContactDropdown,
  })

  const { data: dealsData } = useQuery({
    queryKey: ['deals', 'search', dealSearch],
    queryFn: () => getDeals(1, 20, { search: dealSearch || undefined }),
    enabled: showDealDropdown,
  })

  const { data: assigneeResults } = useQuery({
    queryKey: ['users', 'search', assigneeSearch],
    queryFn: () => searchUsers(assigneeSearch),
    enabled: showAssigneeDropdown,
  })

  const { data: prefillContact } = useQuery({
    queryKey: ['contact', prefillContactId],
    queryFn: () => getContact(prefillContactId!),
    enabled: !!prefillContactId,
  })

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema) as any,
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      status: task?.status ?? 'TODO',
      priority: task?.priority ?? 'MEDIUM',
      dueDate: task?.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '',
      assignedTo: task?.assignedTo ?? '',
      contactId: task?.contactId ?? prefillContactId ?? '',
      dealId: task?.dealId ?? '',
      // Story 4.6 (AC 64-67): recurrence defaults
      isRecurring: task?.isRecurring ?? false,
      recurrencePattern: task?.recurrencePattern ?? '',
      recurrenceEndDate: task?.recurrenceEndDate
        ? new Date(task.recurrenceEndDate).toISOString().split('T')[0]
        : '',
    },
  })

  useEffect(() => {
    if (prefillContact) {
      setContactSearch(`${prefillContact.firstName} ${prefillContact.lastName}`)
    }
  }, [prefillContact])

  const selectedContactId = watch('contactId')
  const selectedDealId = watch('dealId')
  const selectedAssigneeId = watch('assignedTo')
  const isRecurring = watch('isRecurring')

  async function onSubmit(values: TaskFormValues): Promise<void> {
    try {
      const payload = {
        title: values.title.trim(),
        description: values.description?.trim() || undefined,
        status: values.status,
        priority: values.priority,
        dueDate: values.dueDate || undefined,
        assignedTo: values.assignedTo || undefined,
        contactId: values.contactId || undefined,
        dealId: values.dealId || undefined,
        // Story 4.6 (AC 64-67): recurrence payload
        isRecurring: values.isRecurring || undefined,
        recurrencePattern: values.isRecurring ? values.recurrencePattern || undefined : undefined,
        recurrenceEndDate: values.isRecurring ? values.recurrenceEndDate || undefined : undefined,
      }
      let savedTask: Task
      if (task) {
        savedTask = await updateTask(task.id, payload)
      } else if (isFromTemplate && templateId) {
        savedTask = await createTaskFromTemplate(templateId, payload)
      } else {
        savedTask = await createTask(payload)
      }

      if (onSaved) {
        onSaved(savedTask)
        return
      }
      router.push(`/tasks/${savedTask.id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to save task',
      })
    }
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit(onSubmit)}>
      <div className="flex min-h-0 flex-1 flex-col gap-[26px] overflow-y-auto px-6 py-[22px]">
        {!task && isFromTemplate ? (
          <Section title="Template">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className={cn(inputClass, 'cursor-pointer')}
              aria-label="Task template"
            >
              <option value="">Select a template</option>
              {templates?.items.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </Section>
        ) : null}

        <Section title="Task details">
          <Field label="Title" required error={errors.title?.message}>
            <input
              className={inputClass}
              placeholder="Enter task title"
              {...register('title')}
              aria-invalid={Boolean(errors.title)}
            />
          </Field>

          <Field label="Description" error={errors.description?.message}>
            <input
              className={inputClass}
              placeholder="Enter task description"
              {...register('description')}
              aria-invalid={Boolean(errors.description)}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status" error={errors.status?.message}>
              <select
                {...register('status')}
                aria-invalid={Boolean(errors.status)}
                className={cn(inputClass, 'cursor-pointer')}
              >
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {TASK_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Priority" error={errors.priority?.message}>
              <select
                {...register('priority')}
                aria-invalid={Boolean(errors.priority)}
                className={cn(inputClass, 'cursor-pointer')}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {TASK_PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Assignment & timeline">
          <Field label="Assignee" error={errors.assignedTo?.message}>
            <div className="relative">
              <input
                className={inputClass}
                placeholder="Search users..."
                value={assigneeSearch}
                onChange={(e) => {
                  setAssigneeSearch(e.target.value)
                  setShowAssigneeDropdown(true)
                }}
                onFocus={() => setShowAssigneeDropdown(true)}
                aria-label="Search assignee"
              />
              {showAssigneeDropdown && assigneeResults ? (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[9px] border border-[#e6e6eb] bg-white shadow-lg">
                  {assigneeResults.length === 0 ? (
                    <div className="px-3 py-2 text-[13px] text-[#8c8c96]">No users found</div>
                  ) : (
                    assigneeResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className={cn(
                          'block w-full px-3 py-2 text-left text-[13px] hover:bg-[#f4f4f6]',
                          selectedAssigneeId === user.id
                            ? 'bg-[#f4f4f6] font-medium text-[#1b1b1f]'
                            : 'text-[#4b4b55]',
                        )}
                        onClick={() => {
                          setValue('assignedTo', user.id, { shouldValidate: true })
                          setAssigneeSearch(`${user.firstName} ${user.lastName}`)
                          setShowAssigneeDropdown(false)
                        }}
                      >
                        {user.firstName} {user.lastName}
                        <span className="ml-2 text-[12px] text-[#8c8c96]">{user.email}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <input type="hidden" {...register('assignedTo')} />
          </Field>

          <Field label="Due date" error={errors.dueDate?.message}>
            <input
              type="date"
              className={inputClass}
              {...register('dueDate')}
              aria-invalid={Boolean(errors.dueDate)}
            />
          </Field>
        </Section>

        {/* Story 4.6 (AC 64-67): Recurrence section */}
        <Section title="Recurrence">
          <Field label="Recurring task">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[#e6e6eb] accent-[#1b1b1f]"
                {...register('isRecurring')}
              />
              <span className="text-[13px] text-[#4b4b55]">Make this a recurring task</span>
            </label>
          </Field>

          {isRecurring ? (
            <>
              <Field label="Recurrence pattern" required error={errors.recurrencePattern?.message}>
                <select
                  {...register('recurrencePattern')}
                  className={cn(inputClass, 'cursor-pointer')}
                  aria-invalid={Boolean(errors.recurrencePattern)}
                >
                  <option value="">Select a pattern</option>
                  {TASK_RECURRENCE_PATTERNS.map((pattern) => (
                    <option key={pattern} value={pattern}>
                      {TASK_RECURRENCE_PATTERN_LABELS[pattern]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Recurrence end date">
                <input
                  type="date"
                  className={inputClass}
                  {...register('recurrenceEndDate')}
                  aria-label="Recurrence end date"
                />
              </Field>
            </>
          ) : null}
        </Section>

        <Section title="Related records">
          <Field label="Contact" error={errors.contactId?.message}>
            <div className="relative">
              <input
                className={inputClass}
                placeholder="Search contacts..."
                value={contactSearch}
                onChange={(e) => {
                  setContactSearch(e.target.value)
                  setShowContactDropdown(true)
                }}
                onFocus={() => setShowContactDropdown(true)}
                aria-label="Search contacts"
              />
              {showContactDropdown && contactsData ? (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[9px] border border-[#e6e6eb] bg-white shadow-lg">
                  {contactsData.items.length === 0 ? (
                    <div className="px-3 py-2 text-[13px] text-[#8c8c96]">No contacts found</div>
                  ) : (
                    contactsData.items.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        className={cn(
                          'block w-full px-3 py-2 text-left text-[13px] hover:bg-[#f4f4f6]',
                          selectedContactId === contact.id
                            ? 'bg-[#f4f4f6] font-medium text-[#1b1b1f]'
                            : 'text-[#4b4b55]',
                        )}
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
              ) : null}
            </div>
            <input type="hidden" {...register('contactId')} />
          </Field>

          <Field label="Deal" error={errors.dealId?.message}>
            <div className="relative">
              <input
                className={inputClass}
                placeholder="Search deals..."
                value={dealSearch}
                onChange={(e) => {
                  setDealSearch(e.target.value)
                  setShowDealDropdown(true)
                }}
                onFocus={() => setShowDealDropdown(true)}
                aria-label="Search deals"
              />
              {showDealDropdown && dealsData ? (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[9px] border border-[#e6e6eb] bg-white shadow-lg">
                  {dealsData.items.length === 0 ? (
                    <div className="px-3 py-2 text-[13px] text-[#8c8c96]">No deals found</div>
                  ) : (
                    dealsData.items.map((deal) => (
                      <button
                        key={deal.id}
                        type="button"
                        className={cn(
                          'block w-full px-3 py-2 text-left text-[13px] hover:bg-[#f4f4f6]',
                          selectedDealId === deal.id
                            ? 'bg-[#f4f4f6] font-medium text-[#1b1b1f]'
                            : 'text-[#4b4b55]',
                        )}
                        onClick={() => {
                          setValue('dealId', deal.id, { shouldValidate: true })
                          setDealSearch(deal.title)
                          setShowDealDropdown(false)
                        }}
                      >
                        {deal.title}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <input type="hidden" {...register('dealId')} />
          </Field>
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

      <div className="flex items-center justify-end gap-2 border-t border-[#f0f0f4] bg-[#fafafb] px-6 py-3.5">
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
          {isSubmitting ? 'Saving...' : task ? 'Update task' : 'Create task'}
        </button>
      </div>
    </form>
  )
}

type SectionProps = {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#a0a0aa]">
        {title}
      </div>
      {children}
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
