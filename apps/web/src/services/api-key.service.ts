import { graphqlRequest } from './team.service'

export type ApiKey = {
  id: string
  name: string
  keyPrefix: string
  permissions: string[] | null
  expiresAt: string | null
  lastUsedAt: string | null
  isRevoked: boolean
  createdAt: string
  updatedAt: string
}

export type CreateApiKeyResult = {
  id: string
  name: string
  keyPrefix: string
  fullKey: string
  permissions: string[] | null
  expiresAt: string | null
}

export type RotateApiKeyResult = {
  id: string
  fullKey: string
  keyPrefix: string
}

const API_KEYS_QUERY = `query ApiKeys {
  apiKeys {
    id
    name
    keyPrefix
    permissions
    expiresAt
    lastUsedAt
    isRevoked
    createdAt
    updatedAt
  }
}`

const CREATE_API_KEY_MUTATION = `mutation CreateApiKey($input: CreateApiKeyInput!) {
  createApiKey(input: $input) {
    id
    name
    keyPrefix
    fullKey
    permissions
    expiresAt
  }
}`

const REVOKE_API_KEY_MUTATION = `mutation RevokeApiKey($id: ID!) {
  revokeApiKey(id: $id)
}`

const ROTATE_API_KEY_MUTATION = `mutation RotateApiKey($id: ID!) {
  rotateApiKey(id: $id) {
    fullKey
    keyPrefix
  }
}`

export async function getApiKeys(): Promise<ApiKey[]> {
  const data = await graphqlRequest<{ apiKeys: ApiKey[] }>(API_KEYS_QUERY, {})
  return data.apiKeys
}

export async function createApiKey(input: {
  name: string
  permissions?: string[]
}): Promise<CreateApiKeyResult> {
  const data = await graphqlRequest<{ createApiKey: CreateApiKeyResult }>(CREATE_API_KEY_MUTATION, {
    input,
  })
  return data.createApiKey
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ revokeApiKey: boolean }>(REVOKE_API_KEY_MUTATION, { id })
  return data.revokeApiKey
}

export async function rotateApiKey(id: string): Promise<RotateApiKeyResult> {
  const data = await graphqlRequest<{ rotateApiKey: RotateApiKeyResult }>(ROTATE_API_KEY_MUTATION, {
    id,
  })
  return data.rotateApiKey
}
