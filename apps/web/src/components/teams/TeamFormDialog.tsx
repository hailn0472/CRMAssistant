'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createTeam, updateTeam, getTeam } from '@/services/team.service'
import { getUsers } from '@/services/user.service'

const teamFormSchema = z.object({
  name: z.string().trim().min(1, 'Team name is required').max(100, 'Max 100 characters'),
  managerId: z.string().optional(),
})

type TeamFormValues = z.infer<typeof teamFormSchema>

type TeamFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId?: string | null
  onClose?: () => void
}

export function TeamFormDialog({
  open,
  onOpenChange,
  teamId,
  onClose,
}: TeamFormDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const isEditing = !!teamId

  const { data: users } = useQuery({
    queryKey: ['users', { pageSize: 200 }],
    queryFn: async () => {
      const res = await getUsers(1, 200)
      return res.items
    },
    enabled: open,
  })

  const { data: teamDetail } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => getTeam(teamId!),
    enabled: open && isEditing,
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: { name: '', managerId: '' },
  })

  useEffect(() => {
    if (isEditing && teamDetail) {
      reset({ name: teamDetail.name, managerId: teamDetail.managerId ?? '' })
    } else if (!open) {
      reset({ name: '', managerId: '' })
    }
  }, [teamDetail, isEditing, open, reset])

  const createMutation = useMutation({
    mutationFn: createTeam,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      reset()
      onOpenChange(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: { name: string; managerId?: string }) => updateTeam(teamId!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['team', teamId] })
      reset()
      onOpenChange(false)
      onClose?.()
    },
  })

  async function onSubmit(values: TeamFormValues): Promise<void> {
    const input = {
      name: values.name,
      ...(values.managerId ? { managerId: values.managerId } : {}),
    }
    if (isEditing) {
      await updateMutation.mutateAsync(input)
    } else {
      await createMutation.mutateAsync(input)
    }
  }

  const allUsers = users ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Team' : 'Create Team'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div>
            <label htmlFor="team-name" className="mb-1.5 block text-sm font-medium text-slate-700">
              Name
            </label>
            <Input id="team-name" placeholder="e.g. Vietnam Sales Team" {...register('name')} />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="managerId" className="mb-1.5 block text-sm font-medium text-slate-700">
              Manager (optional)
            </label>
            <select
              id="managerId"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              {...register('managerId')}
            >
              <option value="">No manager</option>
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              className="bg-slate-950 text-white hover:bg-slate-800"
              disabled={isSubmitting}
            >
              {isEditing ? 'Save changes' : 'Create team'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
