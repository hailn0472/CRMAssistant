'use client'

import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { getRole, updateRole } from '@/services/role.service'

const editRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Role name is required')
    .max(100, 'Role name must be at most 100 characters'),
  description: z.string().trim().max(500, 'Description must be at most 500 characters').optional(),
})

type EditRoleFormValues = z.infer<typeof editRoleSchema>

function EditRoleForm(): React.JSX.Element {
  const router = useRouter()
  const params = useParams()
  const id = String(params.id)

  const { data, isLoading, error } = useQuery({
    queryKey: ['role', id],
    queryFn: () => getRole(id),
  })

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditRoleFormValues>({
    resolver: zodResolver(editRoleSchema),
    values: data ? { name: data.name, description: data.description ?? '' } : undefined,
  })

  if (isLoading) {
    return <TableSkeleton rows={3} columns={2} />
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to load role.'
    return <ErrorState message={errorMessage} onRetry={() => router.refresh()} />
  }

  if (!data) {
    return <ErrorState message="Role not found" />
  }

  if (data.isSystem) {
    return (
      <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
        <CardContent className="pt-6">
          <p className="text-sm text-amber-700">
            System roles cannot be edited.{' '}
            <Link href={`/settings/roles/${id}`} className="underline">
              View role
            </Link>
          </p>
        </CardContent>
      </Card>
    )
  }

  async function onSubmit(values: EditRoleFormValues): Promise<void> {
    try {
      await updateRole(id, {
        name: values.name,
        description: values.description || undefined,
      })
      router.push(`/settings/roles/${id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to update role',
      })
    }
  }

  return (
    <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="text-lg">Edit role</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <div className="md:col-span-2">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Name
              <Input {...register('name')} aria-invalid={Boolean(errors.name)} />
              {errors.name?.message && (
                <span className="text-xs font-medium text-red-700" role="alert">
                  {errors.name.message}
                </span>
              )}
            </label>
          </div>
          <div className="md:col-span-2">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Description (optional)
              <Input {...register('description')} aria-invalid={Boolean(errors.description)} />
              {errors.description?.message && (
                <span className="text-xs font-medium text-red-700" role="alert">
                  {errors.description.message}
                </span>
              )}
            </label>
          </div>

          {errors.root?.message && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-2"
              role="alert"
            >
              {errors.root.message}
            </p>
          )}

          <div className="flex items-center justify-end border-t border-slate-100 pt-5 md:col-span-2">
            <Button
              disabled={isSubmitting}
              type="submit"
              className="bg-slate-950 text-white hover:bg-slate-800"
            >
              {isSubmitting ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export default function EditRolePage(): React.JSX.Element {
  return (
    <main className="space-y-6 p-6 text-slate-950">
<QueryProvider>
        <EditRoleForm />
      </QueryProvider>
    </main>
  )
}
