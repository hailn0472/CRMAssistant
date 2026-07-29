import {
  getDeals,
  getDeal,
  getDealStages,
  createDeal,
  updateDeal,
  deleteDeal,
  moveDealToStage,
  createDealStage,
  deleteDealStage,
  reorderDealStages,
  type DealFormData,
} from '../deal.service'

const mockFetch = jest.fn()

global.fetch = mockFetch

describe('deal.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('fetches paginated deals', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { deals: { items: [], total: 0, page: 1, pageSize: 10 } },
      }),
    })

    const result = await getDeals(1, 10)

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10 })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('fetches deals with filter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { deals: { items: [], total: 0, page: 1, pageSize: 10 } },
      }),
    })

    const result = await getDeals(1, 10, { search: 'Big' })

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10 })
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.filter).toEqual({ search: 'Big' })
  })

  it('fetches one deal by id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { deal: { id: 'deal-1', title: 'Big Deal' } },
      }),
    })

    await expect(getDeal('deal-1')).resolves.toMatchObject({ id: 'deal-1' })
  })

  it('fetches deal stages', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { dealStages: [{ id: 's1', name: 'Lead', color: '#3B82F6' }] },
      }),
    })

    const result = await getDealStages()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Lead')
  })

  it('creates a deal', async () => {
    const input: DealFormData = {
      title: 'Big Deal',
      stageId: 'stage-1',
      contactId: 'contact-1',
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { createDeal: { id: 'deal-1', ...input } } }),
    })

    await expect(createDeal(input)).resolves.toMatchObject({ id: 'deal-1' })
  })

  it('updates a deal', async () => {
    const input = { title: 'Updated Deal' }
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { updateDeal: { id: 'deal-1', ...input } } }),
    })

    await expect(updateDeal('deal-1', input)).resolves.toMatchObject({ id: 'deal-1' })
  })

  it('deletes a deal', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { deleteDeal: true } }),
    })

    await expect(deleteDeal('deal-1')).resolves.toBe(true)
  })

  it('moves a deal to a stage', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest
        .fn()
        .mockResolvedValue({ data: { moveDealToStage: { id: 'deal-1', stageId: 's2' } } }),
    })

    const result = await moveDealToStage('deal-1', 's2')
    expect(result.stageId).toBe('s2')
  })

  it('creates a deal stage', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest
        .fn()
        .mockResolvedValue({ data: { createDealStage: { id: 's1', name: 'New Stage' } } }),
    })

    const result = await createDealStage('New Stage', '#000')
    expect(result.name).toBe('New Stage')
  })

  it('deletes a deal stage', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { deleteDealStage: true } }),
    })

    await expect(deleteDealStage('s1')).resolves.toBe(true)
  })

  it('reorders deal stages', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          reorderDealStages: [
            { id: 's2', order: 0 },
            { id: 's1', order: 1 },
          ],
        },
      }),
    })

    const result = await reorderDealStages(['s2', 's1'])
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('s2')
  })

  it('throws the first GraphQL error message', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ errors: [{ message: 'Deal not found' }] }),
    })

    await expect(getDeal('missing')).rejects.toThrow('Deal not found')
  })

  it('throws when response has no data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    })

    await expect(getDeals(1, 10)).rejects.toThrow('GraphQL response missing data')
  })

  it('omits filter when all filter fields empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { deals: { items: [], total: 0, page: 1, pageSize: 10 } },
      }),
    })

    await getDeals(1, 10, { search: '' })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.filter).toBeUndefined()
  })
})
