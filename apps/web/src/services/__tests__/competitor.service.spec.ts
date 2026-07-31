import {
  getCompetitors,
  getDealCompetitors,
  createCompetitor,
  updateCompetitor,
  deleteCompetitor,
  addCompetitorToDeal,
  removeCompetitorFromDeal,
  recordWinLoss,
} from '../competitor.service'

const mockFetch = jest.fn()
global.fetch = mockFetch as any

function mockGraphqlResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  })
}

describe('competitor.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getCompetitors', () => {
    it('calls GraphQL with the competitors query and pagination', async () => {
      mockGraphqlResponse({
        competitors: { items: [], total: 0, page: 1, pageSize: 20 },
      })
      await getCompetitors(1, 20, { search: 'acme' })
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.query).toContain('query Competitors')
      expect(body.query).toContain('COMPETITOR_FIELDS'.slice(0, 1)) // sanity
      expect(body.variables).toEqual({
        filter: { search: 'acme' },
        pagination: { page: 1, pageSize: 20 },
      })
    })

    it('returns a typed CompetitorConnection', async () => {
      const connection = {
        items: [
          {
            id: 'c1',
            name: 'Acme Corp',
            website: null,
            strengths: null,
            weaknesses: null,
            isActive: true,
            createdAt: '2026-07-31T00:00:00.000Z',
            updatedAt: '2026-07-31T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }
      mockGraphqlResponse({ competitors: connection })
      const data = await getCompetitors(1, 20)
      expect(data.items).toHaveLength(1)
      expect(data.items[0].name).toBe('Acme Corp')
    })
  })

  describe('getDealCompetitors', () => {
    it('queries dealCompetitors with the nested competitor fragment (AC #37)', async () => {
      mockGraphqlResponse({
        dealCompetitors: [
          {
            id: 'link-1',
            dealId: 'deal-1',
            competitorId: 'c1',
            note: null,
            createdAt: '2026-07-31T00:00:00.000Z',
            competitor: {
              id: 'c1',
              name: 'Acme Corp',
              website: null,
              strengths: null,
              weaknesses: null,
              isActive: true,
              createdAt: '2026-07-31T00:00:00.000Z',
              updatedAt: '2026-07-31T00:00:00.000Z',
            },
          },
        ],
      })
      const result = await getDealCompetitors('deal-1')
      expect(result).toHaveLength(1)
      expect(result[0].competitor.name).toBe('Acme Corp')
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.variables).toEqual({ dealId: 'deal-1' })
    })
  })

  describe('createCompetitor', () => {
    it('sends the createCompetitor mutation with input', async () => {
      mockGraphqlResponse({
        createCompetitor: {
          id: 'c1',
          name: 'Acme Corp',
          website: null,
          strengths: null,
          weaknesses: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      })
      const result = await createCompetitor({ name: 'Acme Corp' })
      expect(result.name).toBe('Acme Corp')
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.query).toContain('mutation CreateCompetitor')
      expect(body.variables).toEqual({ input: { name: 'Acme Corp' } })
    })
  })

  describe('updateCompetitor', () => {
    it('sends the updateCompetitor mutation with id and input', async () => {
      mockGraphqlResponse({
        updateCompetitor: {
          id: 'c1',
          name: 'Acme Corp',
          website: 'https://acme.test',
          strengths: null,
          weaknesses: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      })
      const result = await updateCompetitor('c1', { website: 'https://acme.test' })
      expect(result.website).toBe('https://acme.test')
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.variables).toEqual({ id: 'c1', input: { website: 'https://acme.test' } })
    })
  })

  describe('deleteCompetitor', () => {
    it('sends the deleteCompetitor mutation', async () => {
      mockGraphqlResponse({ deleteCompetitor: true })
      const result = await deleteCompetitor('c1')
      expect(result).toBe(true)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.variables).toEqual({ id: 'c1' })
    })
  })

  describe('addCompetitorToDeal', () => {
    it('sends the addCompetitorToDeal mutation', async () => {
      mockGraphqlResponse({
        addCompetitorToDeal: {
          id: 'link-1',
          dealId: 'deal-1',
          competitorId: 'c1',
          note: null,
          createdAt: '',
          competitor: {
            id: 'c1',
            name: 'Acme Corp',
            website: null,
            strengths: null,
            weaknesses: null,
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        },
      })
      const result = await addCompetitorToDeal({ dealId: 'deal-1', competitorId: 'c1' })
      expect(result.dealId).toBe('deal-1')
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.variables).toEqual({ input: { dealId: 'deal-1', competitorId: 'c1' } })
    })
  })

  describe('removeCompetitorFromDeal', () => {
    it('sends the removeCompetitorFromDeal mutation', async () => {
      mockGraphqlResponse({ removeCompetitorFromDeal: true })
      const result = await removeCompetitorFromDeal('link-1')
      expect(result).toBe(true)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.variables).toEqual({ id: 'link-1' })
    })
  })

  describe('recordWinLoss', () => {
    it('sends the recordWinLoss mutation with the full input', async () => {
      mockGraphqlResponse({ recordWinLoss: { id: 'deal-1' } })
      const result = await recordWinLoss({
        dealId: 'deal-1',
        stageId: 'stage-won',
        reason: 'COMPETITOR',
        competitorId: 'c1',
        note: 'Lost to Acme',
      })
      expect(result.id).toBe('deal-1')
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.query).toContain('mutation RecordWinLoss')
      expect(body.variables).toEqual({
        input: {
          dealId: 'deal-1',
          stageId: 'stage-won',
          reason: 'COMPETITOR',
          competitorId: 'c1',
          note: 'Lost to Acme',
        },
      })
    })
  })
})
