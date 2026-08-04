'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import toast from 'react-hot-toast'

import { assignTask } from '@/services/task.service'
import { searchUsers } from '@/services/owner.service'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import type { Task } from '@/services/task.service'

type AssigneePickerDialogProps = {
  task: Task
  open: boolean
  onOpenChange: (open: boolean) => void
}

function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

export function AssigneePickerDialog({
  task,
  open,
  onOpenChange,
}: AssigneePickerDialogProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  // The teammate list is always visible while the dialog is open — the mock's
  // assign panel is a list, not a type-to-reveal dropdown.
  const { data: users } = useQuery({
    queryKey: ['users', 'search', debouncedSearchTerm],
    // searchUsers can resolve to undefined in tests; TanStack v5 rejects an
    // undefined query result, so normalise to an empty list here.
    queryFn: async () => (await searchUsers(debouncedSearchTerm)) ?? [],
    enabled: open,
  })

  const assignMutation = useMutation({
    mutationFn: (assigneeId: string) => assignTask(task.id, assigneeId),
    onSuccess: () => {
      toast.success('Task assigned')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task.id] })
      router.refresh()
      handleClose()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to assign task')
    },
  })

  const handleClose = (): void => {
    setSearchTerm('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Assign task</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-[#8c8c96]">
            Assign &ldquo;{task.title}&rdquo; to a teammate.
          </p>

          <label className="flex h-[34px] items-center gap-[9px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-[11px] transition-colors focus-within:border-[#1b1b1f] focus-within:bg-white">
            <Search className="h-3.5 w-3.5 flex-none text-[#a0a0aa]" />
            <input
              placeholder="Search teammates"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search users"
              className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[#1b1b1f] outline-none"
            />
          </label>

          <div className="-mx-1 max-h-[250px] overflow-y-auto px-1">
            {!users || users.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-[#a0a0aa]">No users found</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {users.map((user) => {
                  const isCurrent = task.assignedTo === user.id
                  return (
                    <button
                      key={user.id}
                      type="button"
                      disabled={assignMutation.isPending}
                      onClick={() => assignMutation.mutate(user.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[9px] px-[9px] py-2 text-left transition-colors hover:bg-[#f4f4f6] disabled:opacity-60',
                        isCurrent && 'bg-[#fafafb]',
                      )}
                    >
                      <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-[#f0f0f3] text-[10px] font-semibold text-[#4b4b55]">
                        {initials(user.firstName, user.lastName)}
                      </span>
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="text-[13px] font-medium text-[#1b1b1f]">
                          {user.firstName} {user.lastName}
                        </span>
                        <span className="truncate text-[11.5px] text-[#a0a0aa]">{user.email}</span>
                      </span>
                      {isCurrent ? (
                        <Check
                          aria-label="Currently assigned"
                          className="ml-auto h-3.5 w-3.5 flex-none text-[#1b1b1f]"
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-[#f2f2f5] pt-3">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-11 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
