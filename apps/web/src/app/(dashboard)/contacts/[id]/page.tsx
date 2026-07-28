import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { ContactDetailClient } from '@/components/contacts/ContactDetailClient'
import type { Contact } from '@/services/contact.service'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

type ContactPageProps = {
  params: { id: string }
}

type GraphqlContactResponse = {
  data?: { contact: Contact }
  errors?: Array<{ message: string }>
}

async function loadContact(id: string): Promise<Contact> {
  const token = cookies().get(AUTH_COOKIE)?.value
  const response = await fetch(`${API_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: `query Contact($id: ID!) {
        contact(id: $id) {
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
          owner { id firstName lastName email }
          teamId
          tags { id name color }
          createdAt
          updatedAt
        }
      }`,
      variables: { id },
    }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as GraphqlContactResponse
  if (response.status === 401 || response.status === 403) {
    redirect('/login')
  }
  if (
    response.status === 404 ||
    payload.errors?.some((error) => error.message.includes('not found'))
  ) {
    notFound()
  }
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message ?? 'Unable to load contact')
  }
  if (!payload.data?.contact) {
    notFound()
  }
  return payload.data.contact
}

export default async function ContactDetailPage({
  params,
}: ContactPageProps): Promise<React.JSX.Element> {
  const contact = await loadContact(params.id)

  return <ContactDetailClient contact={contact} />
}
