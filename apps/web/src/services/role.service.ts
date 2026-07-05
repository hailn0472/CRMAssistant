export type Role = {
  id: string
  name: string
  description?: string | null
  isSystem: boolean
}

export type RoleWithUserCount = Role & { userCount: number; createdAt: string; updatedAt: string }

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

export async function getRoles(): Promise<RoleWithUserCount[]> {
  const data = await graphqlRequest<{ roles: RoleWithUserCount[] }>(
    `query Roles {
      roles {
        id
        name
        description
        isSystem
        userCount
        createdAt
        updatedAt
      }
    }`,
    {},
  )
  return data.roles
}

export async function getRole(id: string): Promise<RoleWithUserCount> {
  const data = await graphqlRequest<{ role: RoleWithUserCount }>(
    `query Role($id: ID!) {
      role(id: $id) {
        id
        name
        description
        isSystem
        userCount
        createdAt
        updatedAt
      }
    }`,
    { id },
  )
  return data.role
}

export async function getUserRoles(userId: string): Promise<Role[]> {
  const data = await graphqlRequest<{ userRoles: Role[] }>(
    `query UserRoles($userId: ID!) {
      userRoles(userId: $userId) {
        id
        name
        description
        isSystem
      }
    }`,
    { userId },
  )
  return data.userRoles
}

export async function createRole(input: {
  name: string
  description?: string
}): Promise<RoleWithUserCount> {
  const data = await graphqlRequest<{ createRole: RoleWithUserCount }>(
    `mutation CreateRole($input: CreateRoleInput!) {
      createRole(input: $input) {
        id
        name
        description
        isSystem
        userCount
        createdAt
        updatedAt
      }
    }`,
    { input },
  )
  return data.createRole
}

export async function updateRole(
  id: string,
  input: { name?: string; description?: string },
): Promise<RoleWithUserCount> {
  const data = await graphqlRequest<{ updateRole: RoleWithUserCount }>(
    `mutation UpdateRole($id: ID!, $input: UpdateRoleInput!) {
      updateRole(id: $id, input: $input) {
        id
        name
        description
        isSystem
        userCount
        createdAt
        updatedAt
      }
    }`,
    { id, input },
  )
  return data.updateRole
}

export async function deleteRole(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteRole: boolean }>(
    `mutation DeleteRole($id: ID!) {
      deleteRole(id: $id)
    }`,
    { id },
  )
  return data.deleteRole
}

export async function assignRoleToUser(userId: string, roleId: string): Promise<Role> {
  const data = await graphqlRequest<{ assignRoleToUser: Role }>(
    `mutation AssignRoleToUser($userId: ID!, $roleId: ID!) {
      assignRoleToUser(userId: $userId, roleId: $roleId) {
        id
        name
        description
        isSystem
      }
    }`,
    { userId, roleId },
  )
  return data.assignRoleToUser
}

export async function getRoleUsers(
  roleId: string,
): Promise<{ id: string; email: string; firstName: string; lastName: string }[]> {
  const data = await graphqlRequest<{
    roleUsers: { id: string; email: string; firstName: string; lastName: string }[]
  }>(
    `query RoleUsers($roleId: ID!) {
      roleUsers(roleId: $roleId) {
        id
        email
        firstName
        lastName
      }
    }`,
    { roleId },
  )
  return data.roleUsers
}

export async function removeRoleFromUser(userId: string, roleId: string): Promise<boolean> {
  const data = await graphqlRequest<{ removeRoleFromUser: boolean }>(
    `mutation RemoveRoleFromUser($userId: ID!, $roleId: ID!) {
      removeRoleFromUser(userId: $userId, roleId: $roleId)
    }`,
    { userId, roleId },
  )
  return data.removeRoleFromUser
}
