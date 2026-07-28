'use client'

import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, Check, User, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { searchUsers } from '@/services/owner.service'

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

export type OwnerData = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

type BulkAssignResult = {
  successCount: number
  failedCount: number
  errors: Array<{ contactId: string; error: string }>
}

type BulkAssignDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactIds: string[]
  onAssignBulk: (contactIds: string[], userId: string) => Promise<BulkAssignResult>
}

export function BulkAssignDialog({
  open,
  onOpenChange,
  contactIds,
  onAssignBulk,
}: BulkAssignDialogProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [isMutating, setIsMutating] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [result, setResult] = useState<BulkAssignResult | null>(null)
  const debouncedSearch = useDebounce(search, 300)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['search-users', debouncedSearch],
    queryFn: () => searchUsers(debouncedSearch),
    enabled: open,
    staleTime: 30_000,
  })

  const handleConfirm = useCallback(async () => {
    if (!selectedUserId) return

    setIsMutating(true)
    try {
      const bulkResult = await onAssignBulk(contactIds, selectedUserId)
      setResult(bulkResult)

      if (bulkResult.failedCount === 0) {
        toast.success(`Successfully assigned owner to ${bulkResult.successCount} contact(s)`)
        onOpenChange(false)
      } else {
        toast.error(`${bulkResult.successCount} succeeded, ${bulkResult.failedCount} failed`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bulk assignment failed')
    } finally {
      setIsMutating(false)
    }
  }, [selectedUserId, contactIds, onAssignBulk, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Assign Owner to {contactIds.length} Contact(s)</DialogTitle>
          <DialogDescription>
            Select a user to assign as the owner for all selected contacts.
          </DialogDescription>
        </DialogHeader>

        {/* Result display */}
        {result ? (
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-emerald-600">
                <Check className="h-4 w-4" />
                <span>{result.successCount} succeeded</span>
              </div>
              {result.failedCount > 0 ? (
                <div className="flex items-center gap-1.5 text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  <span>{result.failedCount} failed</span>
                </div>
              ) : null}
            </div>

            {result.errors.length > 0 ? (
              <div className="max-h-[150px] overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {result.errors.map((err, i) => (
                  <div key={i} className="flex gap-2 py-0.5">
                    <span className="font-mono">{err.contactId}:</span>
                    <span>{err.error}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users..."
                className="pl-9"
                autoFocus
              />
            </div>

            <div className="max-h-[240px] overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading users...
                </div>
              ) : users.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-sm text-slate-400">
                  <User className="h-8 w-8" />
                  <span>No users found</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {users.map((user) => {
                    const isSelected = selectedUserId === user.id
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedUserId(user.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                          isSelected
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'hover:bg-slate-100 text-slate-700',
                        )}
                      >
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600">
                          {user.firstName.charAt(0)}
                          {user.lastName.charAt(0)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {user.firstName} {user.lastName}
                          </div>
                          <div className="text-xs text-slate-400 truncate">{user.email}</div>
                        </div>
                        {isSelected ? (
                          <Check className="h-4 w-4 flex-shrink-0 text-indigo-600" />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {isMutating ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Assigning owner to {contactIds.length} contact(s)...
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMutating}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={!selectedUserId || isMutating}>
                Assign
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
