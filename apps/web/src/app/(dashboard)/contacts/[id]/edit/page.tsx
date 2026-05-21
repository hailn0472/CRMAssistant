import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { ContactForm } from '@/components/contacts/ContactForm'
import type { Contact } from '@/services/contact.service'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

type EditContactPageProps = {
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

export default async function EditContactPage({
  params,
}: EditContactPageProps): Promise<React.JSX.Element> {
  const contact = await loadContact(params.id)

  return (
    <main className="crm-mesh min-h-screen p-6 text-white">
      <section className="mx-auto max-w-4xl">
        <Link
          className="text-sm text-cyan-100 hover:text-cyan-200"
          href={`/contacts/${contact.id}`}
        >
          Back to contact
        </Link>
        <div className="my-6">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200">
            Edit contact
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">
            {contact.firstName} {contact.lastName}
          </h1>
        </div>
        <ContactForm contact={contact} />
      </section>
    </main>
  )
}
