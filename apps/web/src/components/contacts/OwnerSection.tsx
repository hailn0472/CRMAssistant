'use client'

import { useState, useCallback } from 'react'
import { User, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { OwnerPickerDialog } from '@/components/contacts/OwnerPickerDialog'
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
      <section className="rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4">
        <div className="flex items-center justify-between gap-3">
          {isAssigning ? (
            <div className="flex items-center gap-[11px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0f0f3] text-[#a0a0aa]">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <div className="flex flex-col gap-px">
                <span className="text-[11.5px] text-[#a0a0aa]">Owner</span>
                <span className="flex items-center gap-1.5 text-[13px] text-[#a0a0aa]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Assigning...
                </span>
              </div>
            </div>
          ) : isUnassigned ? (
            <div className="flex items-center gap-[11px]">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0f0f3] text-[#a0a0aa]">
                <User className="h-4 w-4" />
              </span>
              <div className="flex flex-col gap-px">
                <span className="text-[11.5px] text-[#a0a0aa]">Owner</span>
                <span className="text-[13px] text-[#8c8c96]">Unassigned</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-[11px]">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0f0f3] text-[11px] font-semibold text-[#4b4b55]">
                {getInitials(owner.firstName, owner.lastName)}
              </span>
              <div className="flex min-w-0 flex-col gap-px">
                <span className="text-[13px] font-medium text-[#1b1b1f]">{fullName}</span>
                <span className="truncate text-[11.5px] text-[#a0a0aa]">Owner · {owner.email}</span>
              </div>
            </div>
          )}

          {canUpdate ? (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              disabled={isAssigning}
              className="flex-none text-[12px] text-[#4338ca] transition-colors hover:underline disabled:opacity-50"
            >
              Change
            </button>
          ) : null}
        </div>
      </section>

      <OwnerPickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSelect={handleSelect}
        currentOwnerId={optimisticOwnerId}
      />
    </>
  )
}
