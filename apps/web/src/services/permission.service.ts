import type { Permission, PermissionCheck } from '@/types/auth.types'

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

export async function getAllPermissions(): Promise<Permission[]> {
  const data = await graphqlRequest<{ allPermissions: Permission[] }>(
    `query AllPermissions {
      allPermissions {
        id
        resource
        action
        description
      }
    }`,
    {},
  )
  return data.allPermissions
}

export async function getRolePermissions(roleId: string): Promise<Permission[]> {
  const data = await graphqlRequest<{ rolePermissions: Permission[] }>(
    `query RolePermissions($roleId: ID!) {
      rolePermissions(roleId: $roleId) {
        id
        resource
        action
        description
      }
    }`,
    { roleId },
  )
  return data.rolePermissions
}

export async function getMyPermissions(): Promise<PermissionCheck[]> {
  const data = await graphqlRequest<{ myPermissions: PermissionCheck[] }>(
    `query MyPermissions {
      myPermissions {
        resource
        action
        granted
      }
    }`,
    {},
  )
  return data.myPermissions
}

export async function assignPermissionToRole(
  roleId: string,
  permissionId: string,
): Promise<Permission> {
  const data = await graphqlRequest<{ assignPermissionToRole: Permission }>(
    `mutation AssignPermissionToRole($roleId: ID!, $permissionId: ID!) {
      assignPermissionToRole(roleId: $roleId, permissionId: $permissionId) {
        id
        resource
        action
        description
      }
    }`,
    { roleId, permissionId },
  )
  return data.assignPermissionToRole
}

export async function removePermissionFromRole(
  roleId: string,
  permissionId: string,
): Promise<boolean> {
  const data = await graphqlRequest<{ removePermissionFromRole: boolean }>(
    `mutation RemovePermissionFromRole($roleId: ID!, $permissionId: ID!) {
      removePermissionFromRole(roleId: $roleId, permissionId: $permissionId)
    }`,
    { roleId, permissionId },
  )
  return data.removePermissionFromRole
}

export async function setRolePermissions(
  roleId: string,
  permissionIds: string[],
): Promise<Permission[]> {
  const data = await graphqlRequest<{ setRolePermissions: Permission[] }>(
    `mutation SetRolePermissions($roleId: ID!, $permissionIds: [ID!]!) {
      setRolePermissions(roleId: $roleId, permissionIds: $permissionIds) {
        id
        resource
        action
        description
      }
    }`,
    { roleId, permissionIds },
  )
  return data.setRolePermissions
}
