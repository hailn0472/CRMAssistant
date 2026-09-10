export type SharingRule = {
  id: string
  resourceType: 'CONTACT' | 'TASK'
  resourceId: string
  sharedWithUserId: string | null
  sharedWithTeamId: string | null
  accessLevel: 'READ' | 'EDIT' | 'FULL'
  sharedBy: string
  createdAt: string
  updatedAt: string
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

const SHARING_RULE_FIELDS = `
  id
  resourceType
  resourceId
  sharedWithUserId
  sharedWithTeamId
  accessLevel
  sharedBy
  createdAt
  updatedAt
`

export async function getSharingRules(
  resourceType: string,
  resourceId: string,
): Promise<SharingRule[]> {
  const data = await graphqlRequest<{ sharingRules: SharingRule[] }>(
    `query SharingRules($resourceType: String!, $resourceId: ID!) {
      sharingRules(resourceType: $resourceType, resourceId: $resourceId) {
        ${SHARING_RULE_FIELDS}
      }
    }`,
    { resourceType, resourceId },
  )

  return data.sharingRules
}

export async function getSharedWithMe(resourceType?: string): Promise<SharingRule[]> {
  const data = await graphqlRequest<{ sharedWithMe: SharingRule[] }>(
    `query SharedWithMe($resourceType: String) {
      sharedWithMe(resourceType: $resourceType) {
        ${SHARING_RULE_FIELDS}
      }
    }`,
    { resourceType: resourceType ?? null },
  )

  return data.sharedWithMe
}

export async function shareRecord(input: {
  resourceType: string
  resourceId: string
  sharedWithUserId?: string
  sharedWithTeamId?: string
  accessLevel: string
}): Promise<SharingRule> {
  const data = await graphqlRequest<{ shareRecord: SharingRule }>(
    `mutation ShareRecord(
      $resourceType: String!,
      $resourceId: ID!,
      $sharedWithUserId: ID,
      $sharedWithTeamId: ID,
      $accessLevel: String!
    ) {
      shareRecord(
        resourceType: $resourceType,
        resourceId: $resourceId,
        sharedWithUserId: $sharedWithUserId,
        sharedWithTeamId: $sharedWithTeamId,
        accessLevel: $accessLevel
      ) {
        ${SHARING_RULE_FIELDS}
      }
    }`,
    input,
  )

  return data.shareRecord
}

export async function unshareRecord(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ unshareRecord: boolean }>(
    `mutation UnshareRecord($id: ID!) {
      unshareRecord(id: $id)
    }`,
    { id },
  )

  return data.unshareRecord
}

export async function updateSharingAccess(id: string, accessLevel: string): Promise<SharingRule> {
  const data = await graphqlRequest<{ updateSharingAccess: SharingRule }>(
    `mutation UpdateSharingAccess($id: ID!, $accessLevel: String!) {
      updateSharingAccess(id: $id, accessLevel: $accessLevel) {
        ${SHARING_RULE_FIELDS}
      }
    }`,
    { id, accessLevel },
  )

  return data.updateSharingAccess
}
