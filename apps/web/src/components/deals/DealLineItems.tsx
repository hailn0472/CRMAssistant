'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'

import { getDealLineItems, removeLineItem, updateLineItem } from '@/services/product.service'
import { formatCurrency } from '@/components/deals/deal-display'
import { roundMoney, formatDiscount, computeLineItemTotal } from '@/lib/line-item-format'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
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
    <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[#f2f2f5] px-[18px] py-[14px]">
        <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Products</h2>
        <button
          type="button"
          className="h-[30px] rounded-[8px] border border-[#e6e6eb] bg-white px-[11px] text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          onClick={() => setDialogOpen(true)}
        >
          + Add product
        </button>
      </div>

      {error ? (
        <ErrorState message="Failed to load products" />
      ) : !lineItems || lineItems.length === 0 ? (
        <div className="flex items-center gap-[12px] p-[18px]">
          <span className="block h-[30px] w-[30px] flex-none rounded-[8px] border border-dashed border-[#d8d8e0]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[#1b1b1f]">No products yet</span>
            <span className="text-[12px] text-[#8c8c96]">
              Add line items to track what was quoted.
            </span>
          </div>
        </div>
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <caption className="sr-only">Products on this deal</caption>
            <thead>
              <tr className="border-b border-[#f2f2f5] bg-[#fafafb] text-left text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
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
                <tr
                  key={item.id}
                  className="border-b border-[#f4f4f7] transition-colors hover:bg-[#fafafb]"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span>{item.product.name}</span>
                      {!item.product.isActive && (
                        <span className="text-[11.5px] text-[#a0a0aa]">Inactive</span>
                      )}
                      {item.product.currency !== currency && (
                        <span className="text-[11.5px] text-[#c2860a]">
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
                        className="h-8 w-20 rounded-[8px] border border-[#e6e6eb] bg-[#fafafb] px-2 text-[13px] outline-none focus:border-[#1b1b1f] focus:bg-white"
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
                        className="h-8 w-24 rounded-[8px] border border-[#e6e6eb] bg-[#fafafb] px-2 text-[13px] outline-none focus:border-[#1b1b1f] focus:bg-white"
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
                        className="h-8 w-20 rounded-[8px] border border-[#e6e6eb] bg-[#fafafb] px-2 text-[13px] outline-none focus:border-[#1b1b1f] focus:bg-white"
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
                          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[#22a06b] transition-colors hover:bg-[#f4f4f6]"
                          aria-label="Save"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleEditCancel}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[#a0a0aa] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f]"
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
                          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[#a0a0aa] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f]"
                          aria-label="Edit line item"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(item.id)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[#a0a0aa] transition-colors hover:bg-[#f4f4f6] hover:text-[#1b1b1f]"
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
              <tr className="border-t border-[#ececf0] font-semibold">
                <td
                  colSpan={4}
                  className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]"
                >
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
    </section>
  )
}
