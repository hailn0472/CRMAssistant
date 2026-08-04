import { UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { resolveSharedRecordIds } from '../common/guards/sharing-check'
import type { ContactListItemWithSharing, ContactsService } from './contacts.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

type ContactGraphqlShape =
  | (Awaited<ReturnType<ContactsService['findOne']>> & { sharedWithMe?: boolean })
  | ContactListItemWithSharing

const ContactRef = builder.objectRef<ContactGraphqlShape>('Contact')

const UserRef = builder.objectRef<{
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}>('ContactOwner')

UserRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    email: t.exposeString('email'),
    avatar: t.string({
      nullable: true,
      resolve: (owner) => owner.avatar ?? null,
    }),
  }),
})

// Tag shape for Contact type
type TagRefShape = {
  id: string
  name: string
  color: string
}

const TagRef = builder.objectRef<TagRefShape>('ContactTagInfo')

TagRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    color: t.exposeString('color'),
  }),
})

ContactRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    phone: t.exposeString('phone', { nullable: true }),
    company: t.exposeString('company', { nullable: true }),
    jobTitle: t.exposeString('jobTitle', { nullable: true }),
    // Enrichment fields
    linkedin: t.string({
      nullable: true,
      resolve: (contact) =>
        ((contact as Record<string, unknown>).linkedin as string | null) ?? null,
    }),
    twitter: t.string({
      nullable: true,
      resolve: (contact) => ((contact as Record<string, unknown>).twitter as string | null) ?? null,
    }),
    addressStreet: t.string({
      nullable: true,
      resolve: (contact) =>
        ((contact as Record<string, unknown>).addressStreet as string | null) ?? null,
    }),
    addressCity: t.string({
      nullable: true,
      resolve: (contact) =>
        ((contact as Record<string, unknown>).addressCity as string | null) ?? null,
    }),
    addressCountry: t.string({
      nullable: true,
      resolve: (contact) =>
        ((contact as Record<string, unknown>).addressCountry as string | null) ?? null,
    }),
    department: t.string({
      nullable: true,
      resolve: (contact) =>
        ((contact as Record<string, unknown>).department as string | null) ?? null,
    }),
    timezone: t.string({
      nullable: true,
      resolve: (contact) =>
        ((contact as Record<string, unknown>).timezone as string | null) ?? null,
    }),
    language: t.string({
      nullable: true,
      resolve: (contact) =>
        ((contact as Record<string, unknown>).language as string | null) ?? null,
    }),
    source: t.string({
      nullable: true,
      resolve: (contact) => ((contact as Record<string, unknown>).source as string | null) ?? null,
    }),
    notes: t.string({
      nullable: true,
      resolve: (contact) => ((contact as Record<string, unknown>).notes as string | null) ?? null,
    }),
    ownerId: t.exposeString('ownerId'),
    teamId: t.string({
      nullable: true,
      resolve: (contact) => ((contact as Record<string, unknown>).teamId as string | null) ?? null,
    }),
    owner: t.field({
      type: UserRef,
      nullable: true,
      resolve: async (contact) => {
        // Use the contactsService's bound prisma to resolve owner
        // contact object may only have ownerId but not owner relation loaded
        if ('owner' in contact && contact.owner) {
          return contact.owner as {
            id: string
            firstName: string
            lastName: string
            email: string
            avatar?: string | null
          }
        }
        return null
      },
    }),
    sharedWithMe: t.boolean({
      resolve: (contact) => {
        // Pre-computed at service layer for list queries, fallback for findOne
        if (
          'sharedWithMe' in contact &&
          typeof (contact as ContactListItemWithSharing).sharedWithMe === 'boolean'
        ) {
          return (contact as ContactListItemWithSharing).sharedWithMe
        }
        return false
      },
    }),
    tags: t.field({
      type: [TagRef],
      resolve: (contact) => {
        if ('tags' in contact && Array.isArray(contact.tags)) {
          return (contact.tags as Array<{ tag: TagRefShape }>).map((ct) => ct.tag)
        }
        return []
      },
    }),
    createdAt: t.string({ resolve: (contact) => contact.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (contact) => contact.updatedAt.toISOString() }),
  }),
})

const ContactConnectionRef = builder
  .objectRef<Awaited<ReturnType<ContactsService['findMany']>>>('ContactConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [ContactRef], resolve: (connection) => connection.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

const CreateContactInputRef = builder.inputType('CreateContactInput', {
  fields: (t) => ({
    email: t.string({ required: true }),
    firstName: t.string({ required: true }),
    lastName: t.string({ required: true }),
    phone: t.string(),
    company: t.string(),
    jobTitle: t.string(),
    ownerId: t.string(),
    // Enrichment fields
    linkedin: t.string(),
    twitter: t.string(),
    addressStreet: t.string(),
    addressCity: t.string(),
    addressCountry: t.string(),
    department: t.string(),
    timezone: t.string(),
    language: t.string(),
    source: t.string(),
    notes: t.string(),
  }),
})

const UpdateContactInputRef = builder.inputType('UpdateContactInput', {
  fields: (t) => ({
    email: t.string(),
    firstName: t.string(),
    lastName: t.string(),
    phone: t.string(),
    company: t.string(),
    jobTitle: t.string(),
    // Enrichment fields
    linkedin: t.string(),
    twitter: t.string(),
    addressStreet: t.string(),
    addressCity: t.string(),
    addressCountry: t.string(),
    department: t.string(),
    timezone: t.string(),
    language: t.string(),
    source: t.string(),
    notes: t.string(),
  }),
})

const ContactFilterInputRef = builder.inputType('ContactFilterInput', {
  fields: (t) => ({
    search: t.string(),
    company: t.string(),
    jobTitle: t.string(),
    ownerId: t.string(),
    tags: t.stringList(),
    createdAtFrom: t.string(),
    createdAtTo: t.string(),
  }),
})

const ContactPaginationInputRef = builder.inputType('ContactPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const ContactStatsRef = builder
  .objectRef<Awaited<ReturnType<ContactsService['getStats']>>>('ContactStats')
  .implement({
    fields: (t) => ({
      total: t.exposeInt('total'),
      addedThisMonth: t.exposeInt('addedThisMonth'),
      withOpenDeals: t.exposeInt('withOpenDeals'),
      unassigned: t.exposeInt('unassigned'),
    }),
  })

const ENRICHMENT_FIELDS = [
  'linkedin',
  'twitter',
  'addressStreet',
  'addressCity',
  'addressCountry',
  'department',
  'timezone',
  'language',
  'source',
  'notes',
] as const

/// Only forwards the enrichment keys the mutation actually sent, so an omitted
/// field stays untouched while an explicit null clears it.
function enrichmentPatch(
  input: Record<string, unknown>,
): Partial<Record<(typeof ENRICHMENT_FIELDS)[number], string | null>> {
  const patch: Partial<Record<(typeof ENRICHMENT_FIELDS)[number], string | null>> = {}
  for (const field of ENRICHMENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      patch[field] = (input[field] as string | null | undefined) ?? null
    }
  }
  return patch
}

let contactsService: ContactsService | undefined

function getContactsService(): ContactsService {
  if (!contactsService) {
    throw new Error('ContactsService is not initialized')
  }
  return contactsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

builder.queryFields((t) => ({
  contact: t.field({
    type: ContactRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const contact = await getContactsService().findOne(
        user.tenantId,
        user.userId,
        String(args.id),
      )
      // Compute sharing status at query level to avoid N+1
      const sharedIds = await resolveSharedRecordIds(user.userId, user.tenantId, 'CONTACT')
      const result: ContactGraphqlShape = {
        ...contact,
        sharedWithMe: sharedIds.includes(contact.id),
      }
      return result
    },
  }),
  contacts: t.field({
    type: ContactConnectionRef,
    args: {
      filter: t.arg({ type: ContactFilterInputRef }),
      pagination: t.arg({ type: ContactPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getContactsService().findMany(
        user.tenantId,
        user.userId,
        {
          search: args.filter?.search ?? undefined,
          company: args.filter?.company ?? undefined,
          jobTitle: args.filter?.jobTitle ?? undefined,
          ownerId: args.filter?.ownerId ?? undefined,
          tags: args.filter?.tags ?? undefined,
          createdAtFrom: args.filter?.createdAtFrom ?? undefined,
          createdAtTo: args.filter?.createdAtTo ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
  contactStats: t.field({
    type: ContactStatsRef,
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      return getContactsService().getStats(user.tenantId, user.userId)
    },
  }),
}))

builder.mutationFields((t) => ({
  createContact: t.field({
    type: ContactRef,
    args: { input: t.arg({ type: CreateContactInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'CREATE')
      return getContactsService().create(user.tenantId, user.userId, {
        email: args.input.email,
        firstName: args.input.firstName,
        lastName: args.input.lastName,
        phone: args.input.phone ?? undefined,
        company: args.input.company ?? undefined,
        jobTitle: args.input.jobTitle ?? undefined,
        ownerId: args.input.ownerId ?? undefined,
        linkedin: args.input.linkedin ?? undefined,
        twitter: args.input.twitter ?? undefined,
        addressStreet: args.input.addressStreet ?? undefined,
        addressCity: args.input.addressCity ?? undefined,
        addressCountry: args.input.addressCountry ?? undefined,
        department: args.input.department ?? undefined,
        timezone: args.input.timezone ?? undefined,
        language: args.input.language ?? undefined,
        source: args.input.source ?? undefined,
        notes: args.input.notes ?? undefined,
      })
    },
  }),
  updateContact: t.field({
    type: ContactRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateContactInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return getContactsService().update(user.tenantId, user.userId, String(args.id), {
        email: args.input.email ?? undefined,
        firstName: args.input.firstName ?? undefined,
        lastName: args.input.lastName ?? undefined,
        phone: Object.prototype.hasOwnProperty.call(args.input, 'phone')
          ? args.input.phone
          : undefined,
        company: Object.prototype.hasOwnProperty.call(args.input, 'company')
          ? args.input.company
          : undefined,
        jobTitle: Object.prototype.hasOwnProperty.call(args.input, 'jobTitle')
          ? args.input.jobTitle
          : undefined,
        ...enrichmentPatch(args.input),
      })
    },
  }),
  deleteContact: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'DELETE')
      return getContactsService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),
  assignContactOwner: t.field({
    type: ContactRef,
    args: {
      contactId: t.arg.id({ required: true }),
      userId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return getContactsService().assignOwner(
        user.tenantId,
        user.userId,
        String(args.contactId),
        String(args.userId),
      )
    },
  }),
  assignContactTeam: t.field({
    type: ContactRef,
    args: {
      contactId: t.arg.id({ required: true }),
      teamId: t.arg.id({ required: false }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return getContactsService().assignTeam(
        user.tenantId,
        user.userId,
        String(args.contactId),
        args.teamId ? String(args.teamId) : null,
      )
    },
  }),
}))

// Bulk assignment types
const BulkOperationErrorRef = builder
  .objectRef<{
    contactId: string
    error: string
  }>('BulkOperationError')
  .implement({
    fields: (t) => ({
      contactId: t.exposeID('contactId'),
      error: t.exposeString('error'),
    }),
  })

const BulkAssignResultRef = builder
  .objectRef<{
    successCount: number
    failedCount: number
    errors: Array<{ contactId: string; error: string }>
  }>('BulkAssignResult')
  .implement({
    fields: (t) => ({
      successCount: t.exposeInt('successCount'),
      failedCount: t.exposeInt('failedCount'),
      errors: t.field({
        type: [BulkOperationErrorRef],
        resolve: (result) => result.errors,
      }),
    }),
  })

builder.mutationFields((t) => ({
  assignContactOwnerBulk: t.field({
    type: BulkAssignResultRef,
    args: {
      contactIds: t.arg.idList({ required: true }),
      userId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return getContactsService().assignOwnerBulk(
        user.tenantId,
        user.userId,
        args.contactIds.map(String),
        String(args.userId),
      )
    },
  }),
}))

export function registerContactGraphql(service: ContactsService): void {
  contactsService = service
}
