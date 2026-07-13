/** @jest-environment node */

import { POST } from '../route'

const mockFetch = jest.fn()
global.fetch = mockFetch

describe('forgot password route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should forward password recovery requests to the API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })

    const response = await POST(
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      }),
    )

    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(response.status).toBe(200)
    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
    expect(mockFetch).toHaveBeenCalledWith(`${apiUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    })
  })

  it('should return 400 for malformed JSON request bodies', async () => {
    const response = await POST(
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: '{',
      }),
    )

    await expect(response.json()).resolves.toEqual({ message: 'Invalid request body' })
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should preserve API error responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'Too many requests' }),
    })

    const response = await POST(
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      }),
    )

    await expect(response.json()).resolves.toEqual({ message: 'Too many requests' })
    expect(response.status).toBe(429)
  })
})
