import {
  getTags,
  getContactTags,
  createTag,
  deleteTag,
  addTagToContact,
  removeTagFromContact,
} from '../tag.service'

const mockFetch = jest.fn()

global.fetch = mockFetch

describe('tag.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('fetches all tags', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          tags: [
            { id: 'tag-1', name: 'VIP', color: '#EF4444', createdAt: '2026-07-09T00:00:00.000Z' },
          ],
        },
      }),
    })

    const result = await getTags()

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('VIP')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('fetches tags for a contact', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          contactTags: [
            { id: 'tag-1', name: 'VIP', color: '#EF4444', createdAt: '2026-07-09T00:00:00.000Z' },
          ],
        },
      }),
    })

    const result = await getContactTags('contact-1')

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('VIP')
  })

  it('creates a tag', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          createTag: {
            id: 'tag-1',
            name: 'VIP',
            color: '#EF4444',
            createdAt: '2026-07-09T00:00:00.000Z',
          },
        },
      }),
    })

    const result = await createTag('VIP', '#EF4444')

    expect(result.id).toBe('tag-1')
    expect(result.name).toBe('VIP')
  })

  it('creates a tag with default color', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          createTag: {
            id: 'tag-1',
            name: 'VIP',
            color: '#3B82F6',
            createdAt: '2026-07-09T00:00:00.000Z',
          },
        },
      }),
    })

    const result = await createTag('VIP')

    expect(result.color).toBe('#3B82F6')
  })

  it('deletes a tag', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { deleteTag: true } }),
    })

    const result = await deleteTag('tag-1')

    expect(result).toBe(true)
  })

  it('adds a tag to a contact', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { addTagToContact: true } }),
    })

    const result = await addTagToContact('contact-1', 'tag-1')

    expect(result).toBe(true)
  })

  it('removes a tag from a contact', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { removeTagFromContact: true } }),
    })

    const result = await removeTagFromContact('contact-1', 'tag-1')

    expect(result).toBe(true)
  })

  it('throws GraphQL errors', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ errors: [{ message: 'Tag not found' }] }),
    })

    await expect(deleteTag('missing')).rejects.toThrow('Tag not found')
  })

  it('throws when response has no data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    })

    await expect(getTags()).rejects.toThrow('GraphQL response missing data')
  })
})
