import {
  createContact,
  getContact,
  getContacts,
  updateContact,
  type ContactFormData,
} from '../contact.service'

const mockFetch = jest.fn()

global.fetch = mockFetch

describe('contact.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('fetches paginated contacts', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { contacts: { items: [], total: 0, page: 1, pageSize: 10 } },
      }),
    })

    const result = await getContacts(1, 10)

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10 })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('fetches one contact by id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          contact: {
            id: 'contact-1',
            email: 'ada@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
          },
        },
      }),
    })

    await expect(getContact('contact-1')).resolves.toMatchObject({ id: 'contact-1' })
  })

  it('creates a contact', async () => {
    const input: ContactFormData = {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { createContact: { id: 'contact-1', ...input } } }),
    })

    await expect(createContact(input)).resolves.toMatchObject({ id: 'contact-1' })
  })

  it('updates a contact', async () => {
    const input: ContactFormData = {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { updateContact: { id: 'contact-1', ...input } } }),
    })

    await expect(updateContact('contact-1', input)).resolves.toMatchObject({ id: 'contact-1' })
  })

  it('throws the first GraphQL error message', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ errors: [{ message: 'Contact not found' }] }),
    })

    await expect(getContact('missing')).rejects.toThrow('Contact not found')
  })

  it('throws when response has no data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    })

    await expect(getContacts(1, 10)).rejects.toThrow('GraphQL response missing data')
  })
})
