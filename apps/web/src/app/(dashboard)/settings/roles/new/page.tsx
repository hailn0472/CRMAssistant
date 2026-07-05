'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { WorkspaceHeader } from '@/components/layout/AppShell'
import { createRole } from '@/services/role.service'

const roleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Role name is required')
    .max(100, 'Role name must be at most 100 characters'),
  description: z.string().trim().max(500, 'Description must be at most 500 characters').optional(),
})

type RoleFormValues = z.infer<typeof roleSchema>

export default function NewRolePage(): React.JSX.Element {
  const router = useRouter()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: '', description: '' },
  })

  async function onSubmit(values: RoleFormValues): Promise<void> {
    try {
      const role = await createRole({
        name: values.name,
        description: values.description || undefined,
      })
      router.push(`/settings/roles/${role.id}`)
      router.refresh()
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Unable to create role',
      })
    }
  }

  return (
    <main className="space-y-6 p-6 text-slate-950">
      <WorkspaceHeader
        eyebrow="Create role"
        title="New role"
        description="Custom roles can be assigned to users with specific permissions."
        actions={
          <Button asChild variant="outline">
            <Link href="/settings/roles">Back to roles</Link>
          </Button>
        }
      />
      <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg">Role details</CardTitle>
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
                {isSubmitting ? 'Creating...' : 'Create role'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
