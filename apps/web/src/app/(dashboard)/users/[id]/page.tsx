import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { WorkspaceHeader, WorkspacePanel } from '@/components/layout/AppShell'
import { UserRoleAssignment } from '@/components/users/UserRoleAssignment'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import type { User } from '@/services/user.service'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

type UserDetailPageProps = {
  params: { id: string }
}

type GraphqlUserResponse = {
  data?: { user: User }
  errors?: Array<{ message: string }>
}

async function loadUser(id: string): Promise<User> {
  const token = cookies().get(AUTH_COOKIE)?.value
  const response = await fetch(`${API_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: `query User($id: ID!) {
        user(id: $id) {
          id
          tenantId
          email
          firstName
          lastName
          avatar
          phone
          jobTitle
          department
          roles { id name }
          isActive
          lastLoginAt
          createdAt
          updatedAt
        }
      }`,
      variables: { id },
    }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as GraphqlUserResponse
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
    throw new Error(payload.errors?.[0]?.message ?? 'Unable to load user')
  }
  if (!payload.data?.user) {
    notFound()
  }
  return payload.data.user
}

export default async function UserDetailPage({
  params,
}: UserDetailPageProps): Promise<React.JSX.Element> {
  const user = await loadUser(params.id)

  return (
    <main className="space-y-6 p-6 text-slate-950">
      <WorkspaceHeader
        eyebrow="User detail"
        title={`${user.firstName} ${user.lastName}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/users/${user.id}/edit`}>Edit</Link>
          </Button>
        }
      />
      <WorkspacePanel className="p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Detail label="Email" value={user.email} />
          <Detail label="Phone" value={user.phone ?? '—'} />
          <Detail
            label="Role"
            value={
              user.roles && user.roles.length > 0
                ? user.roles.map((r) => r.name).join(', ')
                : 'No roles'
            }
          />
          <Detail label="Status" value={user.isActive ? 'Active' : 'Deactivated'} />
          <Detail label="Job title" value={user.jobTitle ?? '—'} />
          <Detail label="Department" value={user.department ?? '—'} />
          <Detail
            label="Last login"
            value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
          />
          <Detail label="Created" value={new Date(user.createdAt).toLocaleString()} />
        </div>
      </WorkspacePanel>

      <WorkspacePanel className="p-6">
        <p className="text-sm font-semibold text-slate-700 mb-4">Role Assignment</p>
        <QueryProvider>
          <UserRoleAssignment userId={user.id} />
        </QueryProvider>
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
