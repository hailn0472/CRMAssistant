export type Contact = {
  id: string
  email: string
  firstName: string
  lastName: string
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
  createdAt: string
  updatedAt: string
}

export type ContactConnection = {
  items: Contact[]
  total: number
  page: number
  pageSize: number
}

export type ContactFormData = {
  email: string
  firstName: string
  lastName: string
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
}

type GraphqlResponse<T> = {
  data?: T
  errors?: Array<{ message: string }>
}

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const payload = (await response.json()) as GraphqlResponse<T>

  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message ?? 'GraphQL request failed')
  }

  if (!payload.data) {
    throw new Error('GraphQL response missing data')
  }

  return payload.data
}

const CONTACT_FIELDS = `
  id
  email
  firstName
  lastName
  phone
  company
  jobTitle
  createdAt
  updatedAt
`

export async function getContacts(
  page: number,
  pageSize: number,
  search?: string,
): Promise<ContactConnection> {
  const data = await graphqlRequest<{ contacts: ContactConnection }>(
    `query Contacts($filter: ContactFilterInput, $pagination: ContactPaginationInput) {
      contacts(filter: $filter, pagination: $pagination) {
        total
        page
        pageSize
        items { ${CONTACT_FIELDS} }
      }
    }`,
    { filter: search ? { search } : undefined, pagination: { page, pageSize } },
  )

  return data.contacts
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
