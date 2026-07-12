import { UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { TagsService } from './tags.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

type TagShape = {
  id: string
  name: string
  color: string
  createdAt: string
}

const TagRef = builder.objectRef<TagShape>('Tag')

TagRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    color: t.exposeString('color'),
    createdAt: t.exposeString('createdAt'),
  }),
})

const CreateTagInputRef = builder.inputType('CreateTagInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    color: t.string(),
  }),
})

const AddTagToContactInputRef = builder.inputType('AddTagToContactInput', {
  fields: (t) => ({
    contactId: t.string({ required: true }),
    tagId: t.string({ required: true }),
  }),
})

const RemoveTagFromContactInputRef = builder.inputType('RemoveTagFromContactInput', {
  fields: (t) => ({
    contactId: t.string({ required: true }),
    tagId: t.string({ required: true }),
  }),
})

const DeleteTagResultRef = builder.objectRef<{ success: boolean; affectedContacts: number }>(
  'DeleteTagResult',
)

DeleteTagResultRef.implement({
  fields: (t) => ({
    success: t.exposeBoolean('success'),
    affectedContacts: t.exposeInt('affectedContacts'),
  }),
})

const UpdateTagInputRef = builder.inputType('UpdateTagInput', {
  fields: (t) => ({
    name: t.string(),
    color: t.string(),
  }),
})

let tagsService: TagsService | undefined

function getTagsService(): TagsService {
  if (!tagsService) {
    throw new Error('TagsService is not initialized')
  }
  return tagsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

builder.queryFields((t) => ({
  tags: t.field({
    type: [TagRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      const tags = await getTagsService().findAll(user.tenantId)
      return tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt.toISOString(),
      }))
    },
  }),
  contactTags: t.field({
    type: [TagRef],
    args: { contactId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const tags = await getTagsService().findByContact(user.tenantId, String(args.contactId))
      return tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt.toISOString(),
      }))
    },
  }),
}))

builder.mutationFields((t) => ({
  createTag: t.field({
    type: TagRef,
    args: { input: t.arg({ type: CreateTagInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const tag = await getTagsService().create(
        user.tenantId,
        args.input.name,
        args.input.color ?? undefined,
      )
      return {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt.toISOString(),
      }
    },
  }),
  deleteTag: t.field({
    type: DeleteTagResultRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getTagsService().delete(user.tenantId, String(args.id))
    },
  }),
  updateTag: t.field({
    type: TagRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateTagInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const tag = await getTagsService().update(user.tenantId, String(args.id), {
        name: args.input.name ?? undefined,
        color: args.input.color ?? undefined,
      })
      return {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt.toISOString(),
      }
    },
  }),
  addTagToContact: t.boolean({
    args: { input: t.arg({ type: AddTagToContactInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await getTagsService().addTagToContact(user.tenantId, args.input.contactId, args.input.tagId)
      return true
    },
  }),
  removeTagFromContact: t.boolean({
    args: { input: t.arg({ type: RemoveTagFromContactInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await getTagsService().removeTagFromContact(
        user.tenantId,
        args.input.contactId,
        args.input.tagId,
      )
      return true
    },
  }),
}))

export function registerTagGraphql(service: TagsService): void {
  tagsService = service
}
