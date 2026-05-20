import { UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { ContactListItem, ContactsService } from './contacts.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

type ContactGraphqlShape = Awaited<ReturnType<ContactsService['findOne']>> | ContactListItem

const ContactRef = builder.objectRef<ContactGraphqlShape>('Contact')

ContactRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    phone: t.exposeString('phone', { nullable: true }),
    company: t.exposeString('company', { nullable: true }),
    jobTitle: t.exposeString('jobTitle', { nullable: true }),
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
  }),
})

const ContactFilterInputRef = builder.inputType('ContactFilterInput', {
  fields: (t) => ({
    search: t.string(),
    company: t.string(),
  }),
})

const ContactPaginationInputRef = builder.inputType('ContactPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

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
      return getContactsService().findOne(user.tenantId, String(args.id))
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
        {
          search: args.filter?.search ?? undefined,
          company: args.filter?.company ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
}))

builder.mutationFields((t) => ({
  createContact: t.field({
    type: ContactRef,
    args: { input: t.arg({ type: CreateContactInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getContactsService().create(user.tenantId, user.userId, {
        email: args.input.email,
        firstName: args.input.firstName,
        lastName: args.input.lastName,
        phone: args.input.phone ?? undefined,
        company: args.input.company ?? undefined,
        jobTitle: args.input.jobTitle ?? undefined,
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
      })
    },
  }),
  deleteContact: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getContactsService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),
}))

export function registerContactGraphql(service: ContactsService): void {
  contactsService = service
}
