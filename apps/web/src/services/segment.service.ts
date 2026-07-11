export type SavedSegment = {
  id: string
  name: string
  filters: string // JSON-serialized
  createdBy: string
  createdAt: string
  updatedAt: string
}

import { graphqlRequest } from '@/lib/graphql-client'

const SEGMENT_FIELDS = `
  id
  name
  filters
  createdBy
  createdAt
  updatedAt
`

export async function getSavedSegments(): Promise<SavedSegment[]> {
  const data = await graphqlRequest<{ savedSegments: SavedSegment[] }>(
    `query SavedSegments {
      savedSegments { ${SEGMENT_FIELDS} }
    }`,
    {},
  )

  return data.savedSegments
}

export async function createSegment(
  name: string,
  filters: Record<string, unknown>,
): Promise<SavedSegment> {
  const data = await graphqlRequest<{ createSegment: SavedSegment }>(
    `mutation CreateSegment($input: CreateSegmentInput!) {
      createSegment(input: $input) { ${SEGMENT_FIELDS} }
    }`,
    { input: { name, filters: JSON.stringify(filters) } },
  )

  return data.createSegment
}

export async function updateSegment(
  id: string,
  input: { name?: string; filters?: Record<string, unknown> },
): Promise<SavedSegment> {
  const variables: Record<string, unknown> = { id, input: {} }
  if (input.name !== undefined) {
    ;(variables['input'] as Record<string, unknown>)['name'] = input.name
  }
  if (input.filters !== undefined) {
    ;(variables['input'] as Record<string, unknown>)['filters'] = JSON.stringify(input.filters)
  }

  const data = await graphqlRequest<{ updateSegment: SavedSegment }>(
    `mutation UpdateSegment($id: ID!, $input: UpdateSegmentInput!) {
      updateSegment(id: $id, input: $input) { ${SEGMENT_FIELDS} }
    }`,
    variables,
  )

  return data.updateSegment
}

export async function deleteSegment(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteSegment: boolean }>(
    `mutation DeleteSegment($id: ID!) {
      deleteSegment(id: $id)
    }`,
    { id },
  )

  return data.deleteSegment
}
