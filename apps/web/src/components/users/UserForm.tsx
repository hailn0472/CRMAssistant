'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import {
  createUser,
  updateUser,
  type User,
  type CreateUserFormData,
  type UpdateUserFormData,
} from '@/services/user.service'

const userSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  phone: z.string().trim().optional(),
  jobTitle: z.string().trim().optional(),
  department: z.string().trim().optional(),
})

function optionalString(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  return value.trim() || null
}

type UserFormValues = z.infer<typeof userSchema>

type UserFormProps = {
  user?: User
  onSaved?: (user: User) => void
  onCancel?: () => void
}

const inputClass =
  'h-[38px] w-full rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[13.5px] text-[#1b1b1f] outline-none transition-colors placeholder:text-[#9b9ba3] focus:border-[#1b1b1f] focus:bg-white disabled:cursor-not-allowed disabled:bg-[#f0f0f3] disabled:text-[#8c8c96]'

export function UserForm({ user, onSaved, onCancel }: UserFormProps): React.JSX.Element {
  const router = useRouter()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: user?.email ?? '',
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      phone: user?.phone ?? '',
      jobTitle: user?.jobTitle ?? '',
      department: user?.department ?? '',
    },
  })

  async function onSubmit(values: UserFormValues): Promise<void> {
    try {
      let savedUser: User
      if (user) {
        const payload: UpdateUserFormData = {
          email: values.email.trim(),
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          phone: optionalString(values.phone),
          jobTitle: optionalString(values.jobTitle),
          department: optionalString(values.department),
        }
        savedUser = await updateUser(user.id, payload)
      } else {
        const payload: CreateUserFormData = {
          email: values.email.trim(),
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          phone: optionalString(values.phone),
          jobTitle: optionalString(values.jobTitle),
          department: optionalString(values.department),
        }
        savedUser = await createUser(payload)
      }

      if (onSaved) {
        onSaved(savedUser)
        return
      }
      router.push(`/users/${savedUser.id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to save user',
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
              disabled={Boolean(user)}
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

        <Section
          title="Work"
          hint={
            user
              ? undefined
              : 'Roles are assigned on the user’s profile after the account is created.'
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job title" error={errors.jobTitle?.message}>
              <input
                className={inputClass}
                placeholder="VP Operations"
                {...register('jobTitle')}
                aria-invalid={Boolean(errors.jobTitle)}
              />
            </Field>
            <Field label="Department" error={errors.department?.message}>
              <input
                className={inputClass}
                placeholder="Sales"
                {...register('department')}
                aria-invalid={Boolean(errors.department)}
              />
            </Field>
          </div>
        </Section>

        {errors.root?.message ? (
          <p
            className="rounded-[9px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
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
          {isSubmitting ? 'Saving...' : user ? 'Save user' : 'Create user'}
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
        {required ? <span className="text-red-700"> *</span> : null}
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
