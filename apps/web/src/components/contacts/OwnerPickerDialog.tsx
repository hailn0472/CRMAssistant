'use client'

import { useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, Check, User } from 'lucide-react'

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
import { useDebounce } from '@/hooks/useDebounce'

export type OwnerData = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

type OwnerPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (userId: string) => Promise<void>
  currentOwnerId?: string
}

export function OwnerPickerDialog({
  open,
  onOpenChange,
  onSelect,
  currentOwnerId,
}: OwnerPickerDialogProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [isMutating, setIsMutating] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debouncedSearch = useDebounce(search, 300)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['search-users', debouncedSearch],
    queryFn: () => searchUsers(debouncedSearch),
    enabled: open,
    staleTime: 30_000,
  })

  const handleSelect = useCallback(
    async (userId: string) => {
      setIsMutating(true)
      try {
        await onSelect(userId)
        onOpenChange(false)
      } catch {
        // Error handled by parent via toast
      } finally {
        setIsMutating(false)
      }
    },
    [onSelect, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Assign Contact Owner</DialogTitle>
          <DialogDescription>
            Search and select a user to assign as the contact owner.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-[280px] overflow-y-auto">
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
                const isSelected = user.id === currentOwnerId
                return (
                  <button
                    key={user.id}
                    type="button"
                    disabled={isMutating || isSelected}
                    onClick={() => handleSelect(user.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      isSelected
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'hover:bg-slate-100 text-slate-700',
                      isMutating && 'opacity-50 pointer-events-none',
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

        {isMutating && (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Assigning owner...
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMutating}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
