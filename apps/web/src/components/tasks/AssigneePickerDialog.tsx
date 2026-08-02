'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import { assignTask } from '@/services/task.service'
import { searchUsers } from '@/services/owner.service'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Task } from '@/services/task.service'

type AssigneePickerDialogProps = {
  task: Task
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AssigneePickerDialog({
  task,
  open,
  onOpenChange,
}: AssigneePickerDialogProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: users } = useQuery({
    queryKey: ['users', 'search', searchTerm],
    queryFn: () => searchUsers(searchTerm),
    enabled: open && showDropdown,
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
    setShowDropdown(false)
    onOpenChange(false)
  }

  // Close the dropdown on outside click
  useEffect(() => {
    if (!open) return
    const onClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Assign task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-slate-500">Assign &ldquo;{task.title}&rdquo; to a teammate.</p>

          <div className="relative" ref={dropdownRef}>
            <Input
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setShowDropdown(true)
              }}
              onFocus={() => setShowDropdown(true)}
              aria-label="Search users"
            />
            {showDropdown ? (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {!users || users.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-slate-500">No users found</div>
                ) : (
                  users.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50"
                      onClick={() => assignMutation.mutate(user.id)}
                    >
                      {user.firstName} {user.lastName}
                      <span className="ml-2 text-xs text-slate-400">{user.email}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
