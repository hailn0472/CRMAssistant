'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePermission } from '@/hooks/usePermission'
import { useAuthStore } from '@/stores/auth.store'
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PermissionLimitedState,
} from '@/components/shared'
import { getNotes, createNote, updateNote, deleteNote } from '@/services/note.service'
import type { Note, NoteConnection } from '@/services/note.service'

// Story 4.7: NotesPanel — one component, two mount points (contactId or dealId).
// Add/edit/delete follow the house optimistic recipe (TimeEntryList).
// Permission gating reuses the parent's resource; row actions gated by authorship.

const MAX_NOTE_BODY_LENGTH = 5000

const noteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Note is required')
    .max(MAX_NOTE_BODY_LENGTH, 'Note must not exceed 5000 characters'),
})

type NoteFormData = z.infer<typeof noteSchema>

type NotesPanelProps = { contactId: string; dealId?: never } | { dealId: string; contactId?: never }

export function NotesPanel(props: NotesPanelProps) {
  const parentType = props.contactId ? 'CONTACT' : 'DEAL'
  const filter = props.contactId ? { contactId: props.contactId } : { dealId: props.dealId! }

  const canWrite = usePermission(parentType, 'UPDATE')
  const queryClient = useQueryClient()
  const [editingNote, setEditingNote] = useState<Note | null>(null)

  const queryKey = ['notes', filter] as const

  const { data, isLoading, isError, error, refetch } = useQuery<NoteConnection>({
    queryKey,
    queryFn: () => getNotes(filter),
  })

  // ── optimistic mutations ─────────────────────────────────

  const snapshotNotes = () => queryClient.getQueriesData<NoteConnection>({ queryKey: ['notes'] })

  const restoreNotes = (snapshot: ReturnType<typeof snapshotNotes>) => {
    for (const [queryKey, data] of snapshot) {
      if (data) {
        queryClient.setQueriesData<NoteConnection>(queryKey as any, data)
      }
    }
  }

  const addMutation = useMutation({
    mutationFn: (body: string) => createNote({ ...filter, body }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notes'] })
      return { snapshot: snapshotNotes() }
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) restoreNotes(context.snapshot)
      const message = _err instanceof Error ? _err.message : 'Something went wrong'
      toast.error(message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
    onSuccess: () => {
      toast.success('Note saved')
    },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => updateNote(id, body),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notes'] })
      return { snapshot: snapshotNotes() }
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) restoreNotes(context.snapshot)
      const message = _err instanceof Error ? _err.message : 'Something went wrong'
      toast.error(message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
    onSuccess: () => {
      toast.success('Note updated')
      setEditingNote(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notes'] })
      return { snapshot: snapshotNotes() }
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) restoreNotes(context.snapshot)
      const message = _err instanceof Error ? _err.message : 'Something went wrong'
      toast.error(message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
    onSuccess: () => {
      toast.success('Note deleted')
    },
  })

  // ── form ─────────────────────────────────────────────────

  const composerForm = useForm<NoteFormData>({
    resolver: zodResolver(noteSchema) as any,
    defaultValues: { body: '' },
  })

  const editForm = useForm<NoteFormData>({
    resolver: zodResolver(noteSchema) as any,
    defaultValues: { body: '' },
  })

  // ── handlers ─────────────────────────────────────────────

  const handleSave = async (data: NoteFormData) => {
    await addMutation.mutateAsync(data.body)
    composerForm.reset()
  }

  const handleEditSave = async (data: NoteFormData) => {
    if (!editingNote) return
    await editMutation.mutateAsync({ id: editingNote.id, body: data.body })
  }

  const handleDelete = (note: Note) => {
    if (!confirm('Delete this note?')) return
    deleteMutation.mutate(note.id)
  }

  // ── get current user id ──────────────────────────────────
  const currentUser = useAuthStore((s) => s.user)
  const currentUserId = currentUser?.userId ?? ''

  const notes = data?.items ?? []

  // ── render ───────────────────────────────────────────────

  if (isLoading) return <LoadingSkeleton />

  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load notes'}
        onRetry={() => refetch()}
      />
    )
  }

  if (!canWrite && notes.length === 0) {
    return (
      <PermissionLimitedState message="You do not have permission to view notes on this record." />
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Composer ─────────────────────────────────── */}
      {canWrite ? (
        <form onSubmit={composerForm.handleSubmit(handleSave)} noValidate className="space-y-3">
          <label htmlFor="note-body" className="sr-only">
            Write a note
          </label>
          <Textarea
            id="note-body"
            placeholder="Write a note..."
            rows={3}
            {...composerForm.register('body')}
          />
          {composerForm.formState.errors.body && (
            <p role="alert" className="text-sm text-destructive">
              {composerForm.formState.errors.body.message}
            </p>
          )}
          <Button type="submit" size="sm" disabled={addMutation.isPending}>
            {addMutation.isPending ? 'Saving...' : 'Save note'}
          </Button>
        </form>
      ) : (
        <PermissionLimitedState message="You do not have permission to add notes on this record." />
      )}

      {/* ── List ─────────────────────────────────────── */}
      {notes.length === 0 ? (
        <EmptyState title="No notes yet" description="Notes you add here stay with this record." />
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border bg-card p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {note.author.firstName} {note.author.lastName}
                  </span>
                  {' · '}
                  <time dateTime={note.createdAt}>{formatRelativeTime(note.createdAt)}</time>
                  {note.updatedAt !== note.createdAt && (
                    <span className="ml-1 text-xs italic">(edited)</span>
                  )}
                </div>
                {canWrite && note.userId === currentUserId && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={`Edit note by ${note.author.firstName} ${note.author.lastName}`}
                      onClick={() => {
                        editForm.reset({ body: note.body })
                        setEditingNote(note)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11 text-destructive"
                      aria-label={`Delete note by ${note.author.firstName} ${note.author.lastName}`}
                      onClick={() => handleDelete(note)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{note.body}</p>
            </li>
          ))}
        </ul>
      )}

      {/* ── Edit Dialog ──────────────────────────────────────── */}
      <Dialog open={editingNote !== null} onOpenChange={(open) => !open && setEditingNote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit note</DialogTitle>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(handleEditSave)} noValidate className="space-y-4">
            <div>
              <label htmlFor="edit-note-body" className="sr-only">
                Edit note
              </label>
              <Textarea id="edit-note-body" rows={5} {...editForm.register('body')} />
              {editForm.formState.errors.body && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {editForm.formState.errors.body.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingNote(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editMutation.isPending}>
                {editMutation.isPending ? 'Saving...' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  if (diffMs < 0) return date.toLocaleDateString()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
