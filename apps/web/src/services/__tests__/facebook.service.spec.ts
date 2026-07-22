import { getFacebookPages, connectFacebookPage, disconnectFacebookPage } from '../facebook.service'

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

describe('facebookService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getFacebookPages', () => {
    it('returns connected pages without the access token', async () => {
      const pages = [
        {
          id: 'conn-1',
          tenantId: 'tenant-1',
          channel: 'FACEBOOK',
          externalId: 'page-42',
          displayName: 'Acme Page',
          status: 'ACTIVE',
          createdAt: '2026-07-19T00:00:00.000Z',
          updatedAt: '2026-07-19T00:00:00.000Z',
        },
      ]
      mockFetch.mockResolvedValue(jsonResponse({ data: { facebookPages: pages } }))

      const result = await getFacebookPages()

      expect(result).toEqual(pages)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/graphql',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('query FacebookPages'),
        }),
      )
    })
  })

  describe('connectFacebookPage', () => {
    it('sends the page id, access token, and display name', async () => {
      const connection = {
        id: 'conn-1',
        tenantId: 'tenant-1',
        channel: 'FACEBOOK',
        externalId: 'page-42',
        displayName: 'Acme Page',
        status: 'ACTIVE',
        createdAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:00.000Z',
      }
      mockFetch.mockResolvedValue(jsonResponse({ data: { connectFacebookPage: connection } }))

      const result = await connectFacebookPage({
        pageId: 'page-42',
        accessToken: 'EAA-token',
        displayName: 'Acme Page',
      })

      expect(result).toEqual(connection)
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(body.variables.input).toEqual({
        pageId: 'page-42',
        accessToken: 'EAA-token',
        displayName: 'Acme Page',
      })
      expect(body.query).toContain('mutation ConnectFacebookPage')
    })
  })

  describe('disconnectFacebookPage', () => {
    it('disconnects by page id and returns true', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { disconnectFacebookPage: true } }))

      const result = await disconnectFacebookPage('page-42')

      expect(result).toBe(true)
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(body.variables).toEqual({ pageId: 'page-42' })
      expect(body.query).toContain('mutation DisconnectFacebookPage')
    })
  })
})
