'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

import { getProducts, addLineItemToDeal } from '@/services/product.service'
import { computeLineItemTotal, formatDiscount } from '@/lib/line-item-format'
import { formatCurrency } from '@/components/deals/deal-display'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const lineItemSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  quantity: z.coerce.number().gt(0, 'Quantity must be greater than 0').default(1),
  unitPrice: z.coerce.number().min(0, 'Unit price must be 0 or greater').default(0),
  discount: z.coerce
    .number()
    .min(0, 'Discount must be between 0 and 100')
    .max(100, 'Discount must be between 0 and 100')
    .default(0),
})

type LineItemFormValues = z.infer<typeof lineItemSchema>

type LineItemDialogProps = {
  dealId: string
  currency: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LineItemDialog({
  dealId,
  currency,
  open,
  onOpenChange,
}: LineItemDialogProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [productSearch, setProductSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const { data: productsData } = useQuery({
    queryKey: ['products', 'search', productSearch],
    queryFn: () => getProducts(1, 20, { search: productSearch || undefined }),
    enabled: showDropdown || open,
  })

  const addMutation = useMutation({
    mutationFn: (input: LineItemFormValues) =>
      addLineItemToDeal({
        dealId,
        productId: input.productId,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        discount: input.discount,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealLineItems', dealId] })
      router.refresh()
      onOpenChange(false)
      toast.success('Product added to deal')
    },
  })

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema) as any,
    defaultValues: {
      productId: '',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
    },
  })

  const selectedProductId = watch('productId')
  const selectedProduct = productsData?.items?.find((p) => p.id === selectedProductId)
  const qty = watch('quantity')
  const unitPrice = watch('unitPrice')
  const discount = watch('discount')

  const liveTotal = computeLineItemTotal({
    quantity: isNaN(qty) ? 0 : qty,
    unitPrice: isNaN(unitPrice) ? 0 : unitPrice,
    discount: isNaN(discount) ? 0 : discount,
  })

  const onSubmit = async (values: LineItemFormValues): Promise<void> => {
    addMutation.mutate(values)
  }

  const handleProductSelect = (productId: string): void => {
    setValue('productId', productId, { shouldValidate: true })
    const product = productsData?.items?.find((p) => p.id === productId)
    if (product) {
      setValue('unitPrice', product.price)
    }
    setShowDropdown(false)
    setProductSearch('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Product search */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Product</label>
            <div className="relative">
              <Input
                placeholder="Search products..."
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value)
                  setShowDropdown(true)
                }}
                onFocus={() => setShowDropdown(true)}
              />
              {showDropdown && productsData && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {productsData.items.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-500">No products found</div>
                  ) : (
                    productsData.items.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
                          selectedProductId === product.id ? 'bg-indigo-50 font-medium' : ''
                        }`}
                        onClick={() => handleProductSelect(product.id)}
                      >
                        {product.name}
                        <span className="ml-2 text-xs text-slate-400">
                          {formatCurrency(product.price, product.currency)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <input type="hidden" {...register('productId')} />
            {errors.productId && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.productId.message}
              </span>
            )}
            {selectedProduct && !selectedProduct.isActive && (
              <span className="text-xs text-amber-600">This product is inactive</span>
            )}
          </div>

          {/* Quantity */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Quantity</label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              {...register('quantity')}
              aria-invalid={Boolean(errors.quantity)}
            />
            {errors.quantity && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.quantity.message}
              </span>
            )}
          </div>

          {/* Unit price */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Unit price</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              {...register('unitPrice')}
              aria-invalid={Boolean(errors.unitPrice)}
            />
            {errors.unitPrice && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.unitPrice.message}
              </span>
            )}
            {selectedProduct && selectedProduct.currency !== currency && (
              <span className="text-xs text-amber-600">
                Priced in {selectedProduct.currency} &mdash; not converted
              </span>
            )}
          </div>

          {/* Discount */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Discount (%)</label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.1"
              {...register('discount')}
              aria-invalid={Boolean(errors.discount)}
            />
            {errors.discount && (
              <span className="text-xs font-medium text-red-700" role="alert">
                {errors.discount.message}
              </span>
            )}
          </div>

          {/* Live total preview */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Total</span>
              <span className="text-lg font-semibold text-slate-900">
                {formatCurrency(liveTotal, currency)}
              </span>
            </div>
            {discount > 0 && (
              <p className="mt-1 text-xs text-slate-400">
                {qty} &times; {formatCurrency(unitPrice, currency)} with {formatDiscount(discount)}{' '}
                discount
              </p>
            )}
          </div>

          {/* Server error */}
          {addMutation.isError && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {addMutation.error instanceof Error
                ? addMutation.error.message
                : 'Failed to add product'}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || addMutation.isPending}>
              {addMutation.isPending ? 'Adding...' : 'Add to deal'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
