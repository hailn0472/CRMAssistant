'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

import { getDealLineItems, removeLineItem, updateLineItem } from '@/services/product.service'
import { formatCurrency } from '@/components/deals/deal-display'
import { roundMoney, formatDiscount, computeLineItemTotal } from '@/lib/line-item-format'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { Button } from '@/components/ui/button'
import { LineItemDialog } from './LineItemDialog'

type DealLineItemsProps = {
  dealId: string
  currency: string
}

export function DealLineItems({ dealId, currency }: DealLineItemsProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editValues, setEditValues] = useState<{
    quantity: number
    unitPrice: number
    discount: number
  }>({
    quantity: 1,
    unitPrice: 0,
    discount: 0,
  })

  const {
    data: lineItems,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['dealLineItems', dealId],
    queryFn: () => getDealLineItems(dealId),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeLineItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealLineItems', dealId] })
      router.refresh()
      toast.success('Line item removed')
    },
    onError: () => {
      toast.error('Failed to remove line item')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: { quantity: number; unitPrice: number; discount: number }
    }) => updateLineItem(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealLineItems', dealId] })
      router.refresh()
      setEditingId(null)
      toast.success('Line item updated')
    },
    onError: () => {
      toast.error('Failed to update line item')
    },
  })

  const handleRemove = (id: string): void => {
    if (!confirm('Remove this product from the deal?')) return
    removeMutation.mutate(id)
  }

  const handleEditStart = (item: {
    id: string
    quantity: number
    unitPrice: number
    discount: number
  }): void => {
    setEditingId(item.id)
    setEditValues({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount })
  }

  const handleEditSave = (id: string): void => {
    updateMutation.mutate({ id, input: editValues })
  }

  const handleEditCancel = (): void => {
    setEditingId(null)
  }

  const totalSum = roundMoney(lineItems?.reduce((sum, item) => sum + item.total, 0) ?? 0)

  if (isLoading) return <TableSkeleton />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Products</h3>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add product
        </Button>
      </div>

      {error ? (
        <ErrorState message="Failed to load products" />
      ) : !lineItems || lineItems.length === 0 ? (
        <EmptyState
          title="No products on this deal yet"
          description="Add products to track what you are selling in this deal."
        />
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <caption className="sr-only">Products on this deal</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-4 py-3">
                  Product
                </th>
                <th scope="col" className="px-4 py-3">
                  Qty
                </th>
                <th scope="col" className="px-4 py-3">
                  Unit price
                </th>
                <th scope="col" className="px-4 py-3">
                  Discount
                </th>
                <th scope="col" className="px-4 py-3">
                  Total
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span>{item.product.name}</span>
                      {!item.product.isActive && (
                        <span className="text-xs text-slate-400">Inactive</span>
                      )}
                      {item.product.currency !== currency && (
                        <span className="text-xs text-amber-600">
                          Priced in {item.product.currency} &mdash; not converted
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingId === item.id ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-8 w-20 rounded border border-slate-300 px-2 text-sm"
                        value={editValues.quantity}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    ) : (
                      item.quantity
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === item.id ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-8 w-24 rounded border border-slate-300 px-2 text-sm"
                        value={editValues.unitPrice}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            unitPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    ) : (
                      formatCurrency(item.unitPrice, currency)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === item.id ? (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        className="h-8 w-20 rounded border border-slate-300 px-2 text-sm"
                        value={editValues.discount}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            discount: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    ) : (
                      formatDiscount(item.discount)
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {editingId === item.id
                      ? formatCurrency(
                          computeLineItemTotal({
                            quantity: editValues.quantity,
                            unitPrice: editValues.unitPrice,
                            discount: editValues.discount,
                          }),
                          currency,
                        )
                      : formatCurrency(item.total, currency)}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleEditSave(item.id)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-green-600 hover:bg-green-50"
                          aria-label="Save"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleEditCancel}
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                          aria-label="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleEditStart(item)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                          aria-label="Edit line item"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(item.id)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                          aria-label="Remove line item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td colSpan={4} className="px-4 py-3 text-right text-sm uppercase text-slate-500">
                  Total
                </td>
                <td className="px-4 py-3">{formatCurrency(totalSum, currency)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </ResponsiveTableWrapper>
      )}

      <LineItemDialog
        dealId={dealId}
        currency={currency}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
