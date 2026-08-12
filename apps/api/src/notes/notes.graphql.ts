import { NotFoundException, UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { NotesService } from './notes.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── NoteAuthor Type ──────────────────────────────────────

type NoteAuthorShape = {
  id: string
  firstName: string
  lastName: string
}

const NoteAuthorRef = builder.objectRef<NoteAuthorShape>('NoteAuthor')

NoteAuthorRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
  }),
})

// ─── Note Type ────────────────────────────────────────────

type NoteShape = {
  id: string
  contactId: string | null
  dealId: string | null
  userId: string
  body: string
  createdAt: Date
  updatedAt: Date
  author: NoteAuthorShape
}

const NoteRef = builder.objectRef<NoteShape>('Note')

NoteRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    contactId: t.string({
      nullable: true,
      resolve: (n) => n.contactId ?? null,
    }),
    dealId: t.string({
      nullable: true,
      resolve: (n) => n.dealId ?? null,
    }),
    userId: t.exposeID('userId'),
    body: t.exposeString('body'),
    author: t.field({
      type: NoteAuthorRef,
      resolve: (n) => n.author,
    }),
    createdAt: t.string({ resolve: (n) => n.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (n) => n.updatedAt.toISOString() }),
  }),
})

// ─── NoteConnection Type ──────────────────────────────────

const NoteConnectionRef = builder
  .objectRef<{
    items: NoteShape[]
    total: number
    page: number
    pageSize: number
  }>('NoteConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [NoteRef], resolve: (c) => c.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── Input Types ──────────────────────────────────────────

const CreateNoteInputRef = builder.inputType('CreateNoteInput', {
  fields: (t) => ({
    contactId: t.string(),
    dealId: t.string(),
    body: t.string({ required: true }),
  }),
})

const UpdateNoteInputRef = builder.inputType('UpdateNoteInput', {
  fields: (t) => ({
    body: t.string({ required: true }),
  }),
})

const NoteFilterInputRef = builder.inputType('NoteFilterInput', {
  fields: (t) => ({
    contactId: t.string(),
    dealId: t.string(),
  }),
})

const NotePaginationInputRef = builder.inputType('NotePaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service Singletons ────────────────────────────────────

let notesService: NotesService | undefined

function getNotesService(): NotesService {
  if (!notesService) throw new Error('NotesService is not initialized')
  return notesService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Query Fields ──────────────────────────────────────────

builder.queryFields((t) => ({
  notes: t.field({
    type: NoteConnectionRef,
    args: {
      filter: t.arg({ type: NoteFilterInputRef, required: true }),
      pagination: t.arg({ type: NotePaginationInputRef }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      const filter = args.filter as { contactId?: string; dealId?: string }
      await requirePermission(context, filter.dealId ? 'DEAL' : 'CONTACT', 'READ')
      const result = await getNotesService().findManyForParent(
        user.tenantId,
        user.userId,
        filter,
        (args.pagination ?? {}) as Parameters<NotesService['findManyForParent']>[3],
      )
      return result
    },
  }),
}))

// ─── Mutation Fields ──────────────────────────────────────

builder.mutationFields((t) => ({
  createNote: t.field({
    type: NoteRef,
    args: {
      input: t.arg({ type: CreateNoteInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      const input = args.input as { contactId?: string; dealId?: string; body: string }
      await requirePermission(context, input.dealId ? 'DEAL' : 'CONTACT', 'UPDATE')
      const result = await getNotesService().create(
        user.tenantId,
        user.userId,
        input as Parameters<NotesService['create']>[2],
      )
      return result as NoteShape
    },
  }),

  updateNote: t.field({
    type: NoteRef,
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: UpdateNoteInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      // Load the note first to learn its parent, then gate on that resource
      const svc = getNotesService()
      const note = await svc.findOneForGate(user.tenantId, args.id)
      if (!note) {
        throw new NotFoundException('Note not found')
      }
      await requirePermission(context, note.dealId ? 'DEAL' : 'CONTACT', 'UPDATE')
      const result = await svc.update(user.tenantId, user.userId, args.id, args.input)
      return result as NoteShape
    },
  }),

  deleteNote: t.field({
    type: 'Boolean',
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      // Load the note first to learn its parent, then gate on that resource
      const svc = getNotesService()
      const note = await svc.findOneForGate(user.tenantId, args.id)
      if (!note) {
        throw new NotFoundException('Note not found')
      }
      await requirePermission(context, note.dealId ? 'DEAL' : 'CONTACT', 'UPDATE')
      // Pass user.roles through so NotesService.delete can apply ADMIN carve-out
      return svc.delete(user.tenantId, user.userId, args.id, user.roles)
    },
  }),
}))

// ─── Module Registration ──────────────────────────────────

export function registerNotesGraphql(svc: NotesService): void {
  notesService = svc
}
