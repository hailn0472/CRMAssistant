import { getApiKeys, createApiKey, revokeApiKey, rotateApiKey } from '../api-key.service'

const mockFetch = jest.fn()
global.fetch = mockFetch

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    headers: { get: jest.fn(() => 'application/json') },
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('apiKeyService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getApiKeys', () => {
    it('should return all API keys', async () => {
      const keys = [{ id: 'k-1', name: 'Test Key', keyPrefix: 'crm_test', isRevoked: false }]
      mockFetch.mockResolvedValue(jsonResponse({ data: { apiKeys: keys } }))

      const result = await getApiKeys()

      expect(result).toEqual(keys)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/graphql',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('query ApiKeys'),
        }),
      )
    })
  })

  describe('createApiKey', () => {
    it('should create API key and return result with fullKey', async () => {
      const result = {
        id: 'k-1',
        name: 'New Key',
        keyPrefix: 'crm_new',
        fullKey: 'crm_new_full_key_here',
        permissions: null,
        expiresAt: null,
      }
      mockFetch.mockResolvedValue(jsonResponse({ data: { createApiKey: result } }))

      const res = await createApiKey({ name: 'New Key' })

      expect(res).toEqual(result)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/graphql',
        expect.objectContaining({
          body: expect.stringContaining('mutation CreateApiKey'),
        }),
      )
    })

    it('should create API key with permissions', async () => {
      const result = {
        id: 'k-2',
        name: 'Scoped Key',
        keyPrefix: 'crm_scoped',
        fullKey: 'crm_scoped_full_key',
        permissions: ['contact:read', 'deal:read'],
        expiresAt: null,
      }
      mockFetch.mockResolvedValue(jsonResponse({ data: { createApiKey: result } }))

      const res = await createApiKey({
        name: 'Scoped Key',
        permissions: ['contact:read', 'deal:read'],
      })

      expect(res).toEqual(result)
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(body.variables.input.permissions).toEqual(['contact:read', 'deal:read'])
    })
  })

  describe('revokeApiKey', () => {
    it('should revoke API key and return true', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { revokeApiKey: true } }))

      const result = await revokeApiKey('k-1')

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/graphql',
        expect.objectContaining({
          body: expect.stringContaining('mutation RevokeApiKey'),
        }),
      )
    })
  })

  describe('rotateApiKey', () => {
    it('should rotate API key and return new key data', async () => {
      const result = { id: 'k-1', fullKey: 'new_full_key', keyPrefix: 'crm_new' }
      mockFetch.mockResolvedValue(jsonResponse({ data: { rotateApiKey: result } }))

      const res = await rotateApiKey('k-1')

      expect(res).toEqual(result)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/graphql',
        expect.objectContaining({
          body: expect.stringContaining('mutation RotateApiKey'),
        }),
      )
    })
  })
})
