import { getSavedSegments, createSegment, updateSegment, deleteSegment } from '../segment.service'

const mockFetch = jest.fn()

global.fetch = mockFetch

describe('segment.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('fetches saved segments', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          savedSegments: [
            {
              id: 'segment-1',
              name: 'VIP Customers',
              filters: '{"tags":["VIP"]}',
              createdBy: 'user-1',
              createdAt: '2026-07-09T00:00:00.000Z',
              updatedAt: '2026-07-09T00:00:00.000Z',
            },
          ],
        },
      }),
    })

    const result = await getSavedSegments()

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('VIP Customers')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('creates a segment', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          createSegment: {
            id: 'segment-1',
            name: 'VIP Customers',
            filters: '{"tags":["VIP"]}',
            createdBy: 'user-1',
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        },
      }),
    })

    const result = await createSegment('VIP Customers', { tags: ['VIP'] })

    expect(result.name).toBe('VIP Customers')
  })

  it('updates a segment', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          updateSegment: {
            id: 'segment-1',
            name: 'Updated Name',
            filters: '{}',
            createdBy: 'user-1',
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        },
      }),
    })

    const result = await updateSegment('segment-1', { name: 'Updated Name' })

    expect(result.name).toBe('Updated Name')
  })

  it('deletes a segment', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { deleteSegment: true } }),
    })

    const result = await deleteSegment('segment-1')

    expect(result).toBe(true)
  })

  it('throws GraphQL errors', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ errors: [{ message: 'Segment not found' }] }),
    })

    await expect(deleteSegment('missing')).rejects.toThrow('Segment not found')
  })
})
