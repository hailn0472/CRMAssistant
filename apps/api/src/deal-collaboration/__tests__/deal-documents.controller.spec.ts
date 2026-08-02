import { DealDocumentsController } from '../deal-documents.controller'
import { DealDocumentsService } from '../deal-documents.service'
import type { AuditService } from '../../audit/audit.service'
import type { JwtPayload } from '../../auth/strategies/jwt.strategy'

const USER: JwtPayload = {
  sub: 'user-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['ADMIN'],
  email: 'user@example.com',
}

function makeFile(): Express.Multer.File {
  return {
    originalname: 'contract.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake pdf content'),
    size: 42,
  } as Express.Multer.File
}

function makeController(): {
  controller: DealDocumentsController
  dealDocumentsService: { upload: jest.Mock }
  auditService: { log: jest.Mock }
} {
  const dealDocumentsService = { upload: jest.fn() }
  const auditService = { log: jest.fn() }
  const controller = new DealDocumentsController(
    dealDocumentsService as unknown as DealDocumentsService,
    auditService as unknown as AuditService,
  )
  return { controller, dealDocumentsService, auditService }
}

describe('DealDocumentsController', () => {
  it('uploads a document through the service and audits the write with full metadata', async () => {
    const { controller, dealDocumentsService, auditService } = makeController()
    const document = {
      id: 'doc-1',
      fileName: 'contract.pdf',
      fileSize: 42,
      mimeType: 'application/pdf',
    }
    dealDocumentsService.upload.mockResolvedValue(document)

    const result = await controller.uploadDocument({ user: USER } as never, 'deal-1', makeFile())

    expect(dealDocumentsService.upload).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'deal-1',
      expect.objectContaining({ originalname: 'contract.pdf' }),
    )
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'DEAL',
        entityId: 'deal-1',
        details: {
          documentId: 'doc-1',
          fileName: 'contract.pdf',
          fileSize: 42,
          mimeType: 'application/pdf',
        },
      }),
    )
    expect(result).toBe(document)
  })

  it('falls back to unknown placeholders when the document carries no metadata', async () => {
    const { controller, dealDocumentsService, auditService } = makeController()
    dealDocumentsService.upload.mockResolvedValue({})

    await controller.uploadDocument({ user: USER } as never, 'deal-1', makeFile())

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          documentId: 'unknown',
          fileName: 'unknown',
          fileSize: 0,
          mimeType: 'unknown',
        },
      }),
    )
  })
})
