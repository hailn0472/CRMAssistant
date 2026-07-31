'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { createCompetitor, updateCompetitor } from '@/services/competitor.service'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Competitor } from '@/services/competitor.service'

const competitorSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  website: z.string().optional(),
  strengths: z.string().optional(),
  weaknesses: z.string().optional(),
  isActive: z.boolean().default(true),
})

type CompetitorFormValues = z.infer<typeof competitorSchema>

type CompetitorFormProps = {
  competitor?: Competitor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CompetitorForm({
  competitor,
  open,
  onOpenChange,
}: CompetitorFormProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const isEditing = Boolean(competitor)

  const createMutation = useMutation({
    mutationFn: (input: CompetitorFormValues) => createCompetitor(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] })
      onOpenChange(false)
      toast.success('Competitor created')
    },
    onError: (error) => {
      setError('root', {
        message: error instanceof Error ? error.message : 'Failed to create competitor',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CompetitorFormValues> }) =>
      updateCompetitor(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] })
      onOpenChange(false)
      toast.success('Competitor updated')
    },
    onError: (error) => {
      setError('root', {
        message: error instanceof Error ? error.message : 'Failed to update competitor',
      })
    },
  })

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CompetitorFormValues>({
    resolver: zodResolver(competitorSchema) as any,
    defaultValues: {
      name: competitor?.name ?? '',
      website: competitor?.website ?? '',
      strengths: competitor?.strengths ?? '',
      weaknesses: competitor?.weaknesses ?? '',
      isActive: competitor?.isActive ?? true,
    },
  })

  const onSubmit = async (values: CompetitorFormValues): Promise<void> => {
    if (isEditing && competitor) {
      updateMutation.mutate({ id: competitor.id, input: values })
    } else {
      createMutation.mutate(values)
    }
  }

  const handleClose = (): void => {
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit competitor' : 'Add competitor'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="competitor-name">
              Name
            </label>
            <Input id="competitor-name" {...register('name')} aria-invalid={Boolean(errors.name)} />
            {errors.name && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.name.message}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="competitor-website">
              Website
            </label>
            <Input id="competitor-website" {...register('website')} placeholder="https://..." />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="competitor-strengths">
              Strengths
            </label>
            <Input id="competitor-strengths" {...register('strengths')} />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="competitor-weaknesses">
              Weaknesses
            </label>
            <Input id="competitor-weaknesses" {...register('weaknesses')} />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              {...register('isActive')}
              className="h-4 w-4 rounded border-slate-300"
            />
            <label htmlFor="isActive" className="text-sm font-medium text-slate-700">
              Active
            </label>
          </div>

          {errors.root?.message && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {errors.root.message}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
