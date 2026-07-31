'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

import { getProducts, updateProduct } from '@/services/product.service'
import { usePermission } from '@/hooks/usePermission'
import { formatCurrency } from '@/components/deals/deal-display'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { PermissionLimitedState } from '@/components/shared/PermissionLimitedState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { Button } from '@/components/ui/button'
import { ProductForm } from './ProductForm'
import type { Product } from '@/services/product.service'

export function ProductsManager(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)

  const canRead = usePermission('PRODUCT', 'READ')
  const canCreate = usePermission('PRODUCT', 'CREATE')
  const canUpdate = usePermission('PRODUCT', 'UPDATE')

  const { data, isLoading, error } = useQuery({
    queryKey: ['products'],
    queryFn: () => getProducts(1, 100, { includeInactive: true }),
    enabled: canRead,
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateProduct(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Product status updated')
    },
    onError: () => {
      toast.error('Failed to update product')
    },
  })

  if (!canRead) {
    return <PermissionLimitedState message="You do not have permission to view products." />
  }

  if (isLoading) return <TableSkeleton />

  if (error) return <ErrorState message="Failed to load products" />

  const handleEdit = (product: Product): void => {
    setEditingProduct(product)
    setFormOpen(true)
  }

  const handleCreate = (): void => {
    setEditingProduct(null)
    setFormOpen(true)
  }

  const handleToggleActive = (product: Product): void => {
    toggleActiveMutation.mutate({ id: product.id, isActive: !product.isActive })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Products</h2>
        {canCreate && (
          <Button variant="default" size="sm" className="gap-1.5" onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5" />
            Add product
          </Button>
        )}
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Add products to start tracking what you are selling."
        />
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <caption className="sr-only">Products</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-4 py-3">
                  Name
                </th>
                <th scope="col" className="px-4 py-3">
                  Price
                </th>
                <th scope="col" className="px-4 py-3">
                  Currency
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((product) => (
                <tr key={product.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{product.name}</td>
                  <td className="px-4 py-3">{formatCurrency(product.price, product.currency)}</td>
                  <td className="px-4 py-3">{product.currency}</td>
                  <td className="px-4 py-3">
                    <span className={product.isActive ? 'text-green-600' : 'text-slate-400'}>
                      {product.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {canUpdate && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleEdit(product)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                            aria-label="Edit product"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(product)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                            aria-label={
                              product.isActive ? 'Deactivate product' : 'Activate product'
                            }
                          >
                            {product.isActive ? '✕' : '✓'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      <ProductForm
        product={editingProduct}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingProduct(null)
        }}
      />
    </div>
  )
}
