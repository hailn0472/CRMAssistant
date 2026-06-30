export type User = {
  id: string
  tenantId: string
  email: string
  firstName: string
  lastName: string
  avatar?: string | null
  phone?: string | null
  jobTitle?: string | null
  department?: string | null
  role: string
  isActive: boolean
  lastLoginAt?: string | null
  createdAt: string
  updatedAt: string
}

export type UserConnection = {
  items: User[]
  total: number
  page: number
  pageSize: number
}

export type CreateUserFormData = {
  email: string
  firstName: string
  lastName: string
  role?: string
  phone?: string | null
  jobTitle?: string | null
  department?: string | null
}

export type UpdateUserFormData = {
  email?: string
  firstName?: string
  lastName?: string
  role?: string
  phone?: string | null
  jobTitle?: string | null
  department?: string | null
}

export type UpdateProfileFormData = {
  firstName?: string
  lastName?: string
  avatar?: string | null
  phone?: string | null
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

const USER_LIST_FIELDS = `
  id
  email
  firstName
  lastName
  avatar
  role
  isActive
  jobTitle
  department
  lastLoginAt
  createdAt
  updatedAt
`

const USER_FULL_FIELDS = `
  id
  tenantId
  email
  firstName
  lastName
  avatar
  phone
  jobTitle
  department
  role
  isActive
  lastLoginAt
  createdAt
  updatedAt
`

export async function getMe(): Promise<User> {
  const data = await graphqlRequest<{ me: User }>(`query Me { me { ${USER_FULL_FIELDS} } }`, {})
  return data.me
}

export async function getUser(id: string): Promise<User> {
  const data = await graphqlRequest<{ user: User }>(
    `query User($id: ID!) {
      user(id: $id) { ${USER_FULL_FIELDS} }
    }`,
    { id },
  )
  return data.user
}

export async function getUsers(
  page: number,
  pageSize: number,
  filter?: { search?: string; role?: string; isActive?: boolean },
): Promise<UserConnection> {
  const data = await graphqlRequest<{ users: UserConnection }>(
    `query Users($filter: UserFilterInput, $pagination: UserPaginationInput) {
      users(filter: $filter, pagination: $pagination) {
        total
        page
        pageSize
        items { ${USER_LIST_FIELDS} }
      }
    }`,
    { filter: filter || undefined, pagination: { page, pageSize } },
  )
  return data.users
}

export async function createUser(input: CreateUserFormData): Promise<User> {
  const data = await graphqlRequest<{ createUser: User }>(
    `mutation CreateUser($input: CreateUserInput!) {
      createUser(input: $input) { ${USER_FULL_FIELDS} }
    }`,
    { input },
  )
  return data.createUser
}

export async function updateUser(id: string, input: UpdateUserFormData): Promise<User> {
  const data = await graphqlRequest<{ updateUser: User }>(
    `mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
      updateUser(id: $id, input: $input) { ${USER_FULL_FIELDS} }
    }`,
    { id, input },
  )
  return data.updateUser
}

export async function updateProfile(input: UpdateProfileFormData): Promise<User> {
  const data = await graphqlRequest<{ updateProfile: User }>(
    `mutation UpdateProfile($input: UpdateProfileInput!) {
      updateProfile(input: $input) { ${USER_FULL_FIELDS} }
    }`,
    { input },
  )
  return data.updateProfile
}

export async function deactivateUser(id: string): Promise<User> {
  const data = await graphqlRequest<{ deactivateUser: User }>(
    `mutation DeactivateUser($id: ID!) {
      deactivateUser(id: $id) { ${USER_LIST_FIELDS} }
    }`,
    { id },
  )
  return data.deactivateUser
}

export async function reactivateUser(id: string): Promise<User> {
  const data = await graphqlRequest<{ reactivateUser: User }>(
    `mutation ReactivateUser($id: ID!) {
      reactivateUser(id: $id) { ${USER_LIST_FIELDS} }
    }`,
    { id },
  )
  return data.reactivateUser
}

export async function deactivateUsers(ids: string[]): Promise<number> {
  const data = await graphqlRequest<{ deactivateUsers: number }>(
    `mutation DeactivateUsers($ids: [ID!]!) {
      deactivateUsers(ids: $ids)
    }`,
    { ids },
  )
  return data.deactivateUsers
}

export async function reactivateUsers(ids: string[]): Promise<number> {
  const data = await graphqlRequest<{ reactivateUsers: number }>(
    `mutation ReactivateUsers($ids: [ID!]!) {
      reactivateUsers(ids: $ids)
    }`,
    { ids },
  )
  return data.reactivateUsers
}

export async function deleteUser(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteUser: boolean }>(
    `mutation DeleteUser($id: ID!) {
      deleteUser(id: $id)
    }`,
    { id },
  )
  return data.deleteUser
}

export async function uploadAvatar(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/storage/avatar', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(error.message ?? 'Avatar upload failed')
  }

  const data = (await response.json()) as { url: string }
  return data.url
}
