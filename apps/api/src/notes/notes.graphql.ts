import { NotFoundException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { NotesService } from './notes.service'

type NoteShape = {
  id: string
  contactId: string
  userId: string
  body: string
  createdAt: Date
  updatedAt: Date
  author: { id: string; firstName: string; lastName: string }
}

const NoteAuthorRef = builder.objectRef<NoteShape['author']>('NoteAuthor').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
  }),
})

const NoteRef = builder.objectRef<NoteShape>('Note').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    contactId: t.exposeID('contactId'),
    userId: t.exposeID('userId'),
    body: t.exposeString('body'),
    author: t.field({ type: NoteAuthorRef, resolve: (note) => note.author }),
    createdAt: t.string({ resolve: (note) => note.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (note) => note.updatedAt.toISOString() }),
  }),
})

const NoteConnectionRef = builder
  .objectRef<{
    items: NoteShape[]
    total: number
    page: number
    pageSize: number
  }>('NoteConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [NoteRef], resolve: (value) => value.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

const NotePaginationInputRef = builder.inputType('NotePaginationInput', {
  fields: (t) => ({ page: t.int(), pageSize: t.int() }),
})
const CreateNoteInputRef = builder.inputType('CreateNoteInput', {
  fields: (t) => ({ contactId: t.id({ required: true }), body: t.string({ required: true }) }),
})
const UpdateNoteInputRef = builder.inputType('UpdateNoteInput', {
  fields: (t) => ({ body: t.string({ required: true }) }),
})

let notesService: NotesService | undefined
function service(): NotesService {
  if (!notesService) throw new Error('NotesService is not initialized')
  return notesService
}
function user(context: GraphqlContext): NonNullable<GraphqlContext['user']> {
  if (!context.user) throw new UnauthorizedException('Authentication required')
  return context.user
}

builder.queryFields((t) => ({
  notes: t.field({
    type: NoteConnectionRef,
    args: {
      contactId: t.arg.id({ required: true }),
      pagination: t.arg({ type: NotePaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const actor = user(context)
      await requirePermission(context, 'CONTACT', 'READ')
      return service().findManyForContact(actor.tenantId, actor.userId, String(args.contactId), {
        page: args.pagination?.page ?? undefined,
        pageSize: args.pagination?.pageSize ?? undefined,
      })
    },
  }),
}))

builder.mutationFields((t) => ({
  createNote: t.field({
    type: NoteRef,
    args: { input: t.arg({ type: CreateNoteInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const actor = user(context)
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return service().create(actor.tenantId, actor.userId, {
        contactId: String(args.input.contactId),
        body: args.input.body,
      })
    },
  }),
  updateNote: t.field({
    type: NoteRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateNoteInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const actor = user(context)
      const note = await service().findOneForGate(actor.tenantId, String(args.id))
      if (!note) throw new NotFoundException('Note not found')
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return service().update(actor.tenantId, actor.userId, String(args.id), args.input)
    },
  }),
  deleteNote: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const actor = user(context)
      const note = await service().findOneForGate(actor.tenantId, String(args.id))
      if (!note) throw new NotFoundException('Note not found')
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return service().delete(actor.tenantId, actor.userId, String(args.id), actor.roles)
    },
  }),
}))

export function registerNotesGraphql(value: NotesService): void {
  notesService = value
}
