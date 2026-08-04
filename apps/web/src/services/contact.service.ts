export type Contact = {
  id: string
  email: string
  firstName: string
  lastName: string
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
  // Enrichment fields
  linkedin?: string | null
  twitter?: string | null
  addressStreet?: string | null
  addressCity?: string | null
  addressCountry?: string | null
  department?: string | null
  timezone?: string | null
  language?: string | null
  source?: string | null
  notes?: string | null
  ownerId: string
  owner?: {
    id: string
    firstName: string
    lastName: string
    email: string
    avatar?: string | null
  } | null
  teamId?: string | null
  sharedWithMe?: boolean
  tags?: Array<{ id: string; name: string; color: string }>
  createdAt: string
  updatedAt: string
}

export type ContactConnection = {
  items: Contact[]
  total: number
  page: number
  pageSize: number
}

export type ContactStats = {
  total: number
  addedThisMonth: number
  withOpenDeals: number
  unassigned: number
}

export type ContactFormData = {
  email: string
  firstName: string
  lastName: string
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
  /// Create only — existing contacts are reassigned via assignContactOwner.
  ownerId?: string
  // Enrichment fields
  linkedin?: string | null
  twitter?: string | null
  addressStreet?: string | null
  addressCity?: string | null
  addressCountry?: string | null
  department?: string | null
  timezone?: string | null
  language?: string | null
  source?: string | null
  notes?: string | null
}

import { graphqlRequest } from '@/lib/graphql-client'

const CONTACT_FIELDS = `
  id
  email
  firstName
  lastName
  phone
  company
  jobTitle
  linkedin
  twitter
  addressStreet
  addressCity
  addressCountry
  department
  timezone
  language
  source
  notes
  ownerId
  owner { id firstName lastName email avatar }
  teamId
  sharedWithMe
  tags { id name color }
  createdAt
  updatedAt
`

export async function getContacts(
  page: number,
  pageSize: number,
  filter?: {
    search?: string
    company?: string
    jobTitle?: string
    ownerId?: string
    tags?: string[]
    createdAtFrom?: string
    createdAtTo?: string
  },
): Promise<ContactConnection> {
  const hasFilter = Boolean(
    filter?.search ||
      filter?.company ||
      filter?.jobTitle ||
      filter?.ownerId ||
      (filter?.tags && filter.tags.length > 0) ||
      filter?.createdAtFrom ||
      filter?.createdAtTo,
  )
  const data = await graphqlRequest<{ contacts: ContactConnection }>(
    `query Contacts($filter: ContactFilterInput, $pagination: ContactPaginationInput) {
      contacts(filter: $filter, pagination: $pagination) {
        total
        page
        pageSize
        items { ${CONTACT_FIELDS} }
      }
    }`,
    {
      filter: hasFilter ? filter : undefined,
      pagination: { page, pageSize },
    },
  )

  return data.contacts
}

export async function getContactStats(): Promise<ContactStats> {
  const data = await graphqlRequest<{ contactStats: ContactStats }>(
    `query ContactStats {
      contactStats { total addedThisMonth withOpenDeals unassigned }
    }`,
    {},
  )

  return data.contactStats
}

export async function getContact(id: string): Promise<Contact> {
  const data = await graphqlRequest<{ contact: Contact }>(
    `query Contact($id: ID!) {
      contact(id: $id) { ${CONTACT_FIELDS} }
    }`,
    { id },
  )

  return data.contact
}

export async function createContact(input: ContactFormData): Promise<Contact> {
  const data = await graphqlRequest<{ createContact: Contact }>(
    `mutation CreateContact($input: CreateContactInput!) {
      createContact(input: $input) { ${CONTACT_FIELDS} }
    }`,
    { input },
  )

  return data.createContact
}

export async function updateContact(id: string, input: ContactFormData): Promise<Contact> {
  const data = await graphqlRequest<{ updateContact: Contact }>(
    `mutation UpdateContact($id: ID!, $input: UpdateContactInput!) {
      updateContact(id: $id, input: $input) { ${CONTACT_FIELDS} }
    }`,
    { id, input },
  )

  return data.updateContact
}
