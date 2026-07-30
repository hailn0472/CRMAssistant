'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { createProduct, updateProduct } from '@/services/product.service'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Product } from '@/services/product.service'

const productSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  price: z.coerce.number().min(0, 'Price must be 0 or greater').default(0),
  currency: z.string().trim().default('USD'),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
})

type ProductFormValues = z.infer<typeof productSchema>

type ProductFormProps = {
  product?: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProductForm({ product, open, onOpenChange }: ProductFormProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const isEditing = Boolean(product)

  const createMutation = useMutation({
    mutationFn: (input: ProductFormValues) => createProduct(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      onOpenChange(false)
      toast.success('Product created')
    },
    onError: (error) => {
      setError('root', {
        message: error instanceof Error ? error.message : 'Failed to create product',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ProductFormValues> }) =>
      updateProduct(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      onOpenChange(false)
      toast.success('Product updated')
    },
    onError: (error) => {
      setError('root', {
        message: error instanceof Error ? error.message : 'Failed to update product',
      })
    },
  })

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema) as any,
    defaultValues: {
      name: product?.name ?? '',
      price: product?.price ?? 0,
      currency: product?.currency ?? 'USD',
      description: product?.description ?? '',
      isActive: product?.isActive ?? true,
    },
  })

  const onSubmit = async (values: ProductFormValues): Promise<void> => {
    if (isEditing && product) {
      updateMutation.mutate({ id: product.id, input: values })
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
          <DialogTitle>{isEditing ? 'Edit product' : 'Add product'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Name</label>
            <Input {...register('name')} aria-invalid={Boolean(errors.name)} />
            {errors.name && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.name.message}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Price</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              {...register('price')}
              aria-invalid={Boolean(errors.price)}
            />
            {errors.price && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.price.message}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Currency</label>
            <Input {...register('currency')} placeholder="USD" />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <Input {...register('description')} />
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
