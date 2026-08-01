import { InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { SupabaseStorageService } from '../supabase-storage.service'

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}))

import { createClient } from '@supabase/supabase-js'

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>

function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    SUPABASE_STORAGE_BUCKET: 'deal-documents',
    ...overrides,
  }
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService
}

function makeSupabaseMock(): {
  upload: jest.Mock
  createSignedUrl: jest.Mock
  remove: jest.Mock
  from: jest.Mock
} {
  const upload = jest.fn()
  const createSignedUrl = jest.fn()
  const remove = jest.fn()
  const from = jest.fn(() => ({ upload, createSignedUrl, remove }))
  mockCreateClient.mockReturnValue({ storage: { from } } as never)
  return { upload, createSignedUrl, remove, from }
}

describe('SupabaseStorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('constructs without throwing when the service-role key is absent', () => {
    const service = new SupabaseStorageService(makeConfig({ SUPABASE_SERVICE_ROLE_KEY: undefined }))
    expect(service).toBeDefined()
  })

  it('throws "not configured" on first use when the service-role key is missing', async () => {
    const service = new SupabaseStorageService(makeConfig({ SUPABASE_SERVICE_ROLE_KEY: undefined }))
    await expect(
      service.upload('deals/1/2/x.pdf', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow(new InternalServerErrorException('Document storage is not configured'))
  })

  it('uploads the body to the configured bucket with the mime type', async () => {
    const { upload, from } = makeSupabaseMock()
    upload.mockResolvedValue({ data: { path: 'deals/1/2/x.pdf' }, error: null })

    const service = new SupabaseStorageService(makeConfig())
    await service.upload('deals/1/2/x.pdf', Buffer.from('%PDF-1.7'), 'application/pdf')

    expect(from).toHaveBeenCalledWith('deal-documents')
    expect(upload).toHaveBeenCalledWith('deals/1/2/x.pdf', Buffer.from('%PDF-1.7'), {
      contentType: 'application/pdf',
    })
  })

  it('uses the default bucket when SUPABASE_STORAGE_BUCKET is unset', async () => {
    const { upload, from } = makeSupabaseMock()
    upload.mockResolvedValue({ data: { path: 'deals/1/2/x.pdf' }, error: null })
    const service = new SupabaseStorageService(makeConfig({ SUPABASE_STORAGE_BUCKET: undefined }))
    await service.upload('deals/1/2/x.pdf', Buffer.from('x'), 'application/pdf')
    expect(from).toHaveBeenCalledWith('deal-documents')
  })

  it('maps a Supabase upload error to "unavailable"', async () => {
    const { upload } = makeSupabaseMock()
    upload.mockResolvedValue({ data: null, error: { message: 'bucket missing' } })

    const service = new SupabaseStorageService(makeConfig())
    await expect(
      service.upload('deals/1/2/x.pdf', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow(new InternalServerErrorException('Document storage is unavailable'))
  })

  it('creates a signed URL for the object path and TTL', async () => {
    const { createSignedUrl, from } = makeSupabaseMock()
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/x.pdf' },
      error: null,
    })

    const service = new SupabaseStorageService(makeConfig())
    const url = await service.createSignedUrl('deals/1/2/x.pdf', 300)

    expect(from).toHaveBeenCalledWith('deal-documents')
    expect(createSignedUrl).toHaveBeenCalledWith('deals/1/2/x.pdf', 300)
    expect(url).toBe('https://signed.example/x.pdf')
  })

  it('maps a signed-URL error to "unavailable"', async () => {
    const { createSignedUrl } = makeSupabaseMock()
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } })

    const service = new SupabaseStorageService(makeConfig())
    await expect(service.createSignedUrl('deals/1/2/x.pdf', 300)).rejects.toThrow(
      new InternalServerErrorException('Document storage is unavailable'),
    )
  })

  it('maps a missing signed URL to "unavailable"', async () => {
    const { createSignedUrl } = makeSupabaseMock()
    createSignedUrl.mockResolvedValue({ data: { signedUrl: null }, error: null })

    const service = new SupabaseStorageService(makeConfig())
    await expect(service.createSignedUrl('deals/1/2/x.pdf', 300)).rejects.toThrow(
      new InternalServerErrorException('Document storage is unavailable'),
    )
  })

  it('removes the object at the given path', async () => {
    const { remove, from } = makeSupabaseMock()
    remove.mockResolvedValue({ data: null, error: null })

    const service = new SupabaseStorageService(makeConfig())
    await service.remove('deals/1/2/x.pdf')

    expect(from).toHaveBeenCalledWith('deal-documents')
    expect(remove).toHaveBeenCalledWith(['deals/1/2/x.pdf'])
  })

  it('maps a removal error to "unavailable"', async () => {
    const { remove } = makeSupabaseMock()
    remove.mockResolvedValue({ data: null, error: { message: 'gone' } })

    const service = new SupabaseStorageService(makeConfig())
    await expect(service.remove('deals/1/2/x.pdf')).rejects.toThrow(
      new InternalServerErrorException('Document storage is unavailable'),
    )
  })
})
