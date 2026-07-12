import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { UserForm } from '@/components/users/UserForm'
import type { User } from '@/services/user.service'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

type EditUserPageProps = {
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

export default async function EditUserPage({
  params,
}: EditUserPageProps): Promise<React.JSX.Element> {
  const user = await loadUser(params.id)

  return (
    <main className="space-y-6 p-6 text-slate-950">
<UserForm user={user} />
    </main>
  )
}
