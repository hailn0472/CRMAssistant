'use client'

import { useState, useCallback } from 'react'
import { Pencil, User, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { OwnerPickerDialog } from '@/components/contacts/OwnerPickerDialog'
import { cn } from '@/lib/utils'
import type { OwnerData } from '@/components/contacts/OwnerCell'

type OwnerSectionProps = {
  contactId: string
  ownerId: string
  owner?: OwnerData | null
  canUpdate: boolean
  onAssignOwner: (contactId: string, userId: string) => Promise<void>
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

function getAvatarColor(name: string): string {
  const colors = ['bg-indigo-500', 'bg-emerald-500', 'bg-sky-500', 'bg-amber-500']
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export function OwnerSection({
  contactId,
  ownerId,
  owner,
  canUpdate,
  onAssignOwner,
}: OwnerSectionProps): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [optimisticOwnerId, setOptimisticOwnerId] = useState(ownerId)
  const [isAssigning, setIsAssigning] = useState(false)
  const isUnassigned = !owner

  const handleSelect = useCallback(
    async (userId: string) => {
      setIsAssigning(true)
      setOptimisticOwnerId(userId)

      try {
        await onAssignOwner(contactId, userId)
        toast.success('Owner assigned successfully')
      } catch (error) {
        // Revert on error
        setOptimisticOwnerId(ownerId)
        toast.error(error instanceof Error ? error.message : 'Failed to assign owner')
      } finally {
        setIsAssigning(false)
      }
    },
    [contactId, ownerId, onAssignOwner],
  )

  const fullName = owner ? `${owner.firstName} ${owner.lastName}` : ''

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {isAssigning ? (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500">Owner</div>
                  <div className="flex items-center gap-1.5 text-sm text-slate-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Assigning...
                  </div>
                </div>
              </div>
            ) : isUnassigned ? (
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <User className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-xs font-medium text-slate-500">Owner</div>
                  <div className="text-sm text-slate-400">Unassigned</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-white',
                    getAvatarColor(fullName),
                  )}
                >
                  {getInitials(owner.firstName, owner.lastName)}
                </span>
                <div>
                  <div className="text-xs font-medium text-slate-500">Owner</div>
                  <div className="text-sm font-medium text-slate-800">{fullName}</div>
                  <div className="text-xs text-slate-400">{owner.email}</div>
                </div>
              </div>
            )}

            {canUpdate ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialogOpen(true)}
                disabled={isAssigning}
                className="text-slate-400 hover:text-slate-600"
              >
                <Pencil className="h-4 w-4" />
                <span className="ml-1">Edit</span>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <OwnerPickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSelect={handleSelect}
        currentOwnerId={optimisticOwnerId}
      />
    </>
  )
}
