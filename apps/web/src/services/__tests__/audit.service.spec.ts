import { getAuditLogs } from '../audit.service'

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

describe('auditService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getAuditLogs', () => {
    const mockConnection = {
      items: [
        {
          id: '1',
          userId: 'u-1',
          action: 'CREATE',
          entity: 'CONTACT',
          entityId: 'c-1',
          details: 'Created contact',
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
          createdAt: '2026-07-09T12:00:00.000Z',
          user: { id: 'u-1', email: 'test@test.com', firstName: 'John', lastName: 'Doe' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    }

    it('should return paginated audit logs without filters', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { auditLogs: mockConnection } }))

      const result = await getAuditLogs({}, { page: 1, pageSize: 20 })

      expect(result).toEqual(mockConnection)
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(body.variables.pagination).toEqual({ page: 1, pageSize: 20 })
      expect(body.variables.filter).toBeUndefined()
    })

    it('should send filter when all filter fields are provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { auditLogs: mockConnection } }))

      await getAuditLogs(
        {
          userId: 'u-1',
          action: 'CREATE',
          entity: 'CONTACT',
          dateFrom: '2026-01-01',
          dateTo: '2026-12-31',
        },
        {},
      )

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(body.variables.filter).toEqual({
        userId: 'u-1',
        action: 'CREATE',
        entity: 'CONTACT',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      })
    })

    it('should omit empty filter fields', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { auditLogs: mockConnection } }))

      await getAuditLogs(
        { userId: 'u-1', action: '', entity: '', dateFrom: undefined, dateTo: undefined },
        {},
      )

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(body.variables.filter).toEqual({ userId: 'u-1' })
    })

    it('should omit pagination when neither page nor pageSize is set', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { auditLogs: mockConnection } }))

      await getAuditLogs({}, {})

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(body.variables.pagination).toBeUndefined()
    })

    it('should omit variables entirely when no filter or pagination', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { auditLogs: mockConnection } }))

      await getAuditLogs({}, {})

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(body.variables).toEqual({})
    })
  })
})
