'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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
  role: z.enum(['ADMIN', 'MANAGER', 'SALES_REP']),
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
}

export function UserForm({ user }: UserFormProps): React.JSX.Element {
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
      role: (user?.role as UserFormValues['role']) ?? 'SALES_REP',
      phone: user?.phone ?? '',
      jobTitle: user?.jobTitle ?? '',
      department: user?.department ?? '',
    },
  })

  async function onSubmit(values: UserFormValues): Promise<void> {
    try {
      if (user) {
        const payload: UpdateUserFormData = {
          email: values.email.trim(),
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          role: values.role,
          phone: optionalString(values.phone),
          jobTitle: optionalString(values.jobTitle),
          department: optionalString(values.department),
        }
        const savedUser = await updateUser(user.id, payload)
        router.push(`/users/${savedUser.id}`)
      } else {
        const payload: CreateUserFormData = {
          email: values.email.trim(),
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          role: values.role,
          phone: optionalString(values.phone),
          jobTitle: optionalString(values.jobTitle),
          department: optionalString(values.department),
        }
        const savedUser = await createUser(payload)
        router.push(`/users/${savedUser.id}`)
      }
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to save user',
      })
    }
  }

  return (
    <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="text-lg">{user ? 'Edit user' : 'User details'}</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <Field label="Email" error={errors.email?.message}>
            <Input
              type="email"
              disabled={Boolean(user)}
              {...register('email')}
              aria-invalid={Boolean(errors.email)}
            />
          </Field>
          <Field label="Role" error={errors.role?.message}>
            <Select {...register('role')}>
              <option value="SALES_REP">Sales Rep</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>
          <Field label="First name" error={errors.firstName?.message}>
            <Input {...register('firstName')} aria-invalid={Boolean(errors.firstName)} />
          </Field>
          <Field label="Last name" error={errors.lastName?.message}>
            <Input {...register('lastName')} aria-invalid={Boolean(errors.lastName)} />
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            <Input {...register('phone')} aria-invalid={Boolean(errors.phone)} />
          </Field>
          <Field label="Job title" error={errors.jobTitle?.message}>
            <Input {...register('jobTitle')} aria-invalid={Boolean(errors.jobTitle)} />
          </Field>
          <Field label="Department" error={errors.department?.message}>
            <Input {...register('department')} aria-invalid={Boolean(errors.department)} />
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
              {isSubmitting ? 'Saving...' : user ? 'Save user' : 'Create user'}
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
