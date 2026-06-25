import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { WorkspaceHeader, WorkspacePanel } from '@/components/layout/AppShell'
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

  return (
    <main className="space-y-6 p-6 text-slate-950">
      <WorkspaceHeader
        eyebrow="Contact detail"
        title={`${contact.firstName} ${contact.lastName}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/contacts/${contact.id}/edit`}>Edit</Link>
          </Button>
        }
      />
      <WorkspacePanel className="p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Detail label="Email" value={contact.email} />
          <Detail label="Phone" value={contact.phone ?? '—'} />
          <Detail label="Company" value={contact.company ?? '—'} />
          <Detail label="Job title" value={contact.jobTitle ?? '—'} />
          <Detail label="Created" value={new Date(contact.createdAt).toLocaleString()} />
          <Detail label="Updated" value={new Date(contact.updatedAt).toLocaleString()} />
        </div>
      </WorkspacePanel>
    </main>
  )
}

type DetailProps = {
  label: string
  value: string
}

function Detail({ label, value }: DetailProps): React.JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-950">{value}</p>
    </div>
  )
}
