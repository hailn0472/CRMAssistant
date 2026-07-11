'use client'

import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/shared/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { getTags, createTag, deleteTag, updateTag } from '@/services/tag.service'

const PRESET_COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // green
  '#F59E0B', // amber
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#84CC16', // lime
  '#6366F1', // indigo
  '#14B8A6', // teal
  '#E11D48', // rose
]

type TagManagementDialogProps = {
  trigger?: React.ReactElement
}

export function TagManagementDialog({ trigger }: TagManagementDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3B82F6')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const queryClient = useQueryClient()

  const {
    data: tags = [],
    isLoading,
    error: tagsError,
  } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags,
  })

  const createMutation = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => createTag(name, color),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
      setNewName('')
      setNewColor('#3B82F6')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
      void queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setDeleteConfirmId(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name?: string; color?: string }) =>
      updateTag(id, { name, color }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
      setEditId(null)
    },
  })

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) return
    try {
      await createMutation.mutateAsync({ name: newName.trim(), color: newColor })
    } catch {
      // Error handled by mutation state
    }
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) setDeleteConfirmId(null)
        setOpen(next)
      }}
      open={open}
    >
      <DialogTrigger>{trigger ?? <Button type="button">Manage tags</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Manage tags</DialogTitle>
          <DialogDescription>
            Create, edit, or delete tags for organizing contacts.
          </DialogDescription>
        </DialogHeader>

        {/* Create tag form */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-slate-700">New tag</label>
          <div className="flex gap-2">
            <Input
              placeholder="Tag name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
              }}
            />
            <Button
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => void handleCreate()}
              type="button"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                className={`h-7 w-7 rounded-full border-2 transition-all ${
                  newColor === color ? 'border-slate-950 scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
                onClick={() => setNewColor(color)}
                type="button"
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
        </div>

        {/* Tag list */}
        <div className="max-h-[300px] space-y-1 overflow-y-auto">
          {isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : tagsError ? (
            <ErrorState
              message="Unable to load tags."
              onRetry={() => queryClient.invalidateQueries({ queryKey: ['tags'] })}
            />
          ) : tags.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">
              No tags yet. Create your first tag above.
            </p>
          ) : (
            tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-slate-50"
              >
                {editId === tag.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <div className="flex flex-wrap gap-1">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          className={`h-5 w-5 rounded-full border-2 transition-all ${
                            editColor === c ? 'border-slate-950 scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                          onClick={() => setEditColor(c)}
                          type="button"
                          aria-label={`Select color ${c}`}
                        />
                      ))}
                    </div>
                    <Input
                      className="h-8 flex-1"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <Button
                      className="h-7 text-xs"
                      disabled={!editName.trim() || updateMutation.isPending}
                      onClick={() =>
                        void updateMutation.mutateAsync({
                          id: tag.id,
                          name: editName.trim(),
                          color: editColor,
                        })
                      }
                      type="button"
                      size="sm"
                    >
                      Save
                    </Button>
                    <Button
                      className="h-7 text-xs"
                      onClick={() => setEditId(null)}
                      type="button"
                      variant="ghost"
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-sm font-medium text-slate-700">{tag.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        className="h-7 text-xs"
                        onClick={() => {
                          setEditId(tag.id)
                          setEditName(tag.name)
                          setEditColor(tag.color)
                        }}
                        type="button"
                        variant="ghost"
                        size="sm"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      {deleteConfirmId === tag.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            className="h-7 text-xs"
                            onClick={() => void deleteMutation.mutateAsync(tag.id)}
                            type="button"
                            variant="destructive"
                            size="sm"
                          >
                            Confirm
                          </Button>
                          <Button
                            className="h-7 text-xs"
                            onClick={() => setDeleteConfirmId(null)}
                            type="button"
                            variant="ghost"
                            size="sm"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          className="h-7 text-xs text-red-600 hover:text-red-700"
                          onClick={() => setDeleteConfirmId(tag.id)}
                          type="button"
                          variant="ghost"
                          size="sm"
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="outline">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
