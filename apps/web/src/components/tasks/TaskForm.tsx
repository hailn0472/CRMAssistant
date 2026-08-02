'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  createTask,
  updateTask,
  createTaskFromTemplate,
  getTaskTemplates,
} from '@/services/task.service'
import { getContacts } from '@/services/contact.service'
import { getDeals } from '@/services/deal.service'
import { searchUsers } from '@/services/owner.service'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '@/lib/task-format'
import type { Task } from '@/services/task.service'

const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.string().optional(),
  assignedTo: z.string().optional(),
  contactId: z.string().optional(),
  dealId: z.string().optional(),
})

type TaskFormValues = z.infer<typeof taskSchema>

type TaskFormProps = {
  task?: Task
}

export function TaskForm({ task }: TaskFormProps): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromTemplate = searchParams.get('fromTemplate') === '1'

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
    enabled: fromTemplate,
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
      contactId: task?.contactId ?? '',
      dealId: task?.dealId ?? '',
    },
  })

  const selectedContactId = watch('contactId')
  const selectedDealId = watch('dealId')
  const selectedAssigneeId = watch('assignedTo')

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
      }
      let savedTask: Task
      if (task) {
        savedTask = await updateTask(task.id, payload)
      } else if (fromTemplate && templateId) {
        savedTask = await createTaskFromTemplate(templateId, payload)
      } else {
        savedTask = await createTask(payload)
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
    <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="text-lg">{task ? 'Edit task' : 'Create task'}</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          {!task && fromTemplate ? (
            <Field label="Template" error={errors.title?.message}>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                aria-label="Task template"
              >
                <option value="">Select a template</option>
                {templates?.items.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="Title" error={undefined}>
            <Input
              {...register('title')}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'task-title-error' : undefined}
              placeholder="Enter task title"
            />
            {errors.title ? (
              <span id="task-title-error" className="text-xs font-medium text-red-700" role="alert">
                {errors.title.message}
              </span>
            ) : null}
          </Field>

          <Field label="Description" error={errors.description?.message}>
            <Input
              {...register('description')}
              aria-invalid={Boolean(errors.description)}
              placeholder="Enter task description"
            />
          </Field>

          <Field label="Status" error={errors.status?.message}>
            <select
              {...register('status')}
              aria-invalid={Boolean(errors.status)}
              className="flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
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
              className="flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {TASK_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Due date" error={errors.dueDate?.message}>
            <Input type="date" {...register('dueDate')} aria-invalid={Boolean(errors.dueDate)} />
          </Field>

          <Field label="Assignee" error={errors.assignedTo?.message}>
            <div className="relative">
              <Input
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
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {assigneeResults.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-500">No users found</div>
                  ) : (
                    assigneeResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
                          selectedAssigneeId === user.id ? 'bg-indigo-50 font-medium' : ''
                        }`}
                        onClick={() => {
                          setValue('assignedTo', user.id, { shouldValidate: true })
                          setAssigneeSearch(`${user.firstName} ${user.lastName}`)
                          setShowAssigneeDropdown(false)
                        }}
                      >
                        {user.firstName} {user.lastName}
                        <span className="ml-2 text-xs text-slate-400">{user.email}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <input type="hidden" {...register('assignedTo')} />
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
                aria-label="Search contacts"
              />
              {showContactDropdown && contactsData ? (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {contactsData.items.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-500">No contacts found</div>
                  ) : (
                    contactsData.items.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
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
              ) : null}
            </div>
            <input type="hidden" {...register('contactId')} />
          </Field>

          <Field label="Deal" error={errors.dealId?.message}>
            <div className="relative">
              <Input
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
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {dealsData.items.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-500">No deals found</div>
                  ) : (
                    dealsData.items.map((deal) => (
                      <button
                        key={deal.id}
                        type="button"
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
                          selectedDealId === deal.id ? 'bg-indigo-50 font-medium' : ''
                        }`}
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
              {isSubmitting ? 'Saving...' : task ? 'Update task' : 'Create task'}
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
