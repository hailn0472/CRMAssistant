import { BadRequestException, NotFoundException } from '@nestjs/common'

import { DealDocumentsService } from '../deal-documents.service'
import { SIGNED_URL_TTL_SECONDS } from '../../storage/supabase-storage.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { DealsService } from '../../deals/deals.service'
import type { SupabaseStorageService } from '../../storage/supabase-storage.service'

const mockUploader = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  avatar: null,
}

const mockDocument = {
  id: 'doc-1',
  tenantId: 'tenant-1',
  dealId: 'deal-1',
  fileName: 'contract.pdf',
  storagePath: 'deals/tenant-1/deal-1/doc-1-contract.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  uploadedBy: 'user-1',
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
  uploader: mockUploader,
}

function makePrismaMock(): {
  dealDocument: {
    findFirst: jest.Mock
    findMany: jest.Mock
    create: jest.Mock
    updateMany: jest.Mock
  }
} {
  return {
    dealDocument: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  }
}

function makeDealsMock(): { findOne: jest.Mock } {
  return { findOne: jest.fn() }
}

function makeStorageMock(): {
  upload: jest.Mock
  createSignedUrl: jest.Mock
  remove: jest.Mock
} {
  return {
    upload: jest.fn().mockResolvedValue(undefined),
    createSignedUrl: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  }
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    originalname: 'contract.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nfake-pdf-content'),
    size: 1024,
    ...overrides,
  } as Express.Multer.File
}

describe('DealDocumentsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>
  let deals: ReturnType<typeof makeDealsMock>
  let storage: ReturnType<typeof makeStorageMock>
  let service: DealDocumentsService

  beforeEach(() => {
    prisma = makePrismaMock()
    deals = makeDealsMock()
    storage = makeStorageMock()
    service = new DealDocumentsService(
      prisma as unknown as PrismaService,
      deals as unknown as DealsService,
      storage as unknown as SupabaseStorageService,
    )
    deals.findOne.mockResolvedValue({ id: 'deal-1' })
  })

  describe('upload', () => {
    it('verifies deal access, uploads to the tenant-first object path and creates the row', async () => {
      prisma.dealDocument.create.mockResolvedValue(mockDocument)

      const result = await service.upload('tenant-1', 'user-1', 'deal-1', makeFile())

      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      const uploadCall = storage.upload.mock.calls[0]
      expect(uploadCall[0]).toMatch(/^deals\/tenant-1\/deal-1\/[0-9a-f-]{36}-contract\.pdf$/)
      expect(uploadCall[1]).toEqual(Buffer.from('%PDF-1.7\nfake-pdf-content'))
      expect(uploadCall[2]).toBe('application/pdf')

      const createData = prisma.dealDocument.create.mock.calls[0][0].data
      expect(createData).toMatchObject({
        tenantId: 'tenant-1',
        dealId: 'deal-1',
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        uploadedBy: 'user-1',
        createdBy: 'user-1',
        updatedBy: 'user-1',
      })
      expect(createData.storagePath).toBe(uploadCall[0])
      // The row insert reuses the same id embedded in the storage object path.
      const embeddedId = createData.storagePath.match(
        /deals\/tenant-1\/deal-1\/([0-9a-f-]{36})-/,
      )?.[1]
      expect(embeddedId).toBeDefined()
      expect(createData.id).toBe(embeddedId)
      expect(result).toEqual(mockDocument)
    })

    it('rejects a file whose extension or magic bytes are not allowed', async () => {
      const file = makeFile({
        originalname: 'contract.pdf',
        buffer: Buffer.from('MZ\x90\x00this-is-an-exe'),
      })

      await expect(service.upload('tenant-1', 'user-1', 'deal-1', file)).rejects.toThrow(
        new BadRequestException('Unsupported file type. Allowed: PDF, DOCX, XLSX, PNG, JPG'),
      )
      expect(storage.upload).not.toHaveBeenCalled()
      expect(prisma.dealDocument.create).not.toHaveBeenCalled()
    })

    it('rejects an extension outside the allowlist before touching storage', async () => {
      const file = makeFile({ originalname: 'virus.exe', mimetype: 'application/octet-stream' })

      await expect(service.upload('tenant-1', 'user-1', 'deal-1', file)).rejects.toThrow(
        BadRequestException,
      )
      expect(storage.upload).not.toHaveBeenCalled()
    })

    it('removes the orphaned object when the row insert fails, rethrowing the original error', async () => {
      storage.upload.mockResolvedValue(undefined)
      const insertError = new Error('unique constraint violation')
      prisma.dealDocument.create.mockRejectedValue(insertError)

      await expect(service.upload('tenant-1', 'user-1', 'deal-1', makeFile())).rejects.toThrow(
        insertError,
      )
      expect(storage.remove).toHaveBeenCalledWith(
        expect.stringMatching(/^deals\/tenant-1\/deal-1\//),
      )
    })

    it('does not mask the original error even when orphan cleanup itself fails', async () => {
      storage.upload.mockResolvedValue(undefined)
      storage.remove.mockRejectedValue(new Error('storage down'))
      const insertError = new Error('insert failed')
      prisma.dealDocument.create.mockRejectedValue(insertError)

      await expect(service.upload('tenant-1', 'user-1', 'deal-1', makeFile())).rejects.toThrow(
        insertError,
      )
    })
  })

  describe('findManyForDeal', () => {
    it('resolves deal access once and lists active documents newest-first', async () => {
      prisma.dealDocument.findMany.mockResolvedValue([mockDocument])

      const result = await service.findManyForDeal('tenant-1', 'user-1', 'deal-1')

      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(deals.findOne).toHaveBeenCalledTimes(1)
      expect(prisma.dealDocument.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', dealId: 'deal-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          uploader: {
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          },
        },
      })
      expect(result).toEqual([mockDocument])
    })
  })

  describe('createDownloadUrl', () => {
    it('loads the document, re-verifies the deal from the loaded row and mints a signed URL', async () => {
      prisma.dealDocument.findFirst.mockResolvedValue(mockDocument)
      storage.createSignedUrl.mockResolvedValue('https://signed.example/contract.pdf')

      const url = await service.createDownloadUrl('tenant-1', 'user-1', 'doc-1')

      expect(prisma.dealDocument.findFirst).toHaveBeenCalledWith({
        where: { id: 'doc-1', tenantId: 'tenant-1', deletedAt: null },
      })
      // Re-verification must use the LOADED row's dealId, never a client-supplied id.
      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(storage.createSignedUrl).toHaveBeenCalledWith(
        'deals/tenant-1/deal-1/doc-1-contract.pdf',
        SIGNED_URL_TTL_SECONDS,
      )
      expect(url).toBe('https://signed.example/contract.pdf')
    })

    it('surfaces Deal not found when the caller cannot see the loaded document deal', async () => {
      prisma.dealDocument.findFirst.mockResolvedValue(mockDocument)
      deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))

      await expect(service.createDownloadUrl('tenant-1', 'user-1', 'doc-1')).rejects.toThrow(
        new NotFoundException('Deal not found'),
      )
      expect(storage.createSignedUrl).not.toHaveBeenCalled()
    })

    it('throws Document not found for a missing or soft-deleted row', async () => {
      prisma.dealDocument.findFirst.mockResolvedValue(null)

      await expect(service.createDownloadUrl('tenant-1', 'user-1', 'doc-missing')).rejects.toThrow(
        new NotFoundException('Document not found'),
      )
      expect(deals.findOne).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('soft-deletes the row and hard-removes the storage object', async () => {
      prisma.dealDocument.findFirst.mockResolvedValue(mockDocument)
      prisma.dealDocument.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.delete('tenant-1', 'user-1', 'doc-1')

      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(prisma.dealDocument.updateMany).toHaveBeenCalledWith({
        where: { id: 'doc-1', tenantId: 'tenant-1', deletedAt: null },
        data: { deletedAt: expect.any(Date), updatedBy: 'user-1' },
      })
      expect(storage.remove).toHaveBeenCalledWith('deals/tenant-1/deal-1/doc-1-contract.pdf')
      expect(result).toBe(true)
    })

    it('swallows storage removal failures — the row is already gone from view', async () => {
      prisma.dealDocument.findFirst.mockResolvedValue(mockDocument)
      prisma.dealDocument.updateMany.mockResolvedValue({ count: 1 })
      storage.remove.mockRejectedValue(new Error('storage down'))

      await expect(service.delete('tenant-1', 'user-1', 'doc-1')).resolves.toBe(true)
    })

    it('throws Document not found for a missing row and never touches storage', async () => {
      prisma.dealDocument.findFirst.mockResolvedValue(null)

      await expect(service.delete('tenant-1', 'user-1', 'doc-missing')).rejects.toThrow(
        new NotFoundException('Document not found'),
      )
      expect(storage.remove).not.toHaveBeenCalled()
    })
  })
})
