import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'

import { PrismaService } from '../prisma/prisma.service'
import { DealsService } from '../deals/deals.service'
import { SupabaseStorageService, SIGNED_URL_TTL_SECONDS } from '../storage/supabase-storage.service'
import { detectDocumentType, sanitizeFileName } from './file-types'

/**
 * Nested uploader select — every field DealDocumentRef exposes (AC 27).
 */
const DOCUMENT_INCLUDE: Record<string, unknown> = {
  uploader: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
    },
  },
}

/**
 * Deal document attachments (Story 3.6).
 *
 * All methods route deal access through `DealsService.findOne` — the single
 * authorization primitive (tenant scope + soft delete + visibility) — exactly
 * like `DealLineItemsService`. `DealDocument` has no `ownerId`, so
 * `resolveVisibilityFilter` must NOT be applied a second time on top of it.
 *
 * Upload has two writes that cannot be one transaction (the object store is
 * not in the database transaction): generate the id first, upload second,
 * insert third. Insert failure after a successful upload leaves an orphaned
 * object — best-effort `remove()` in a catch that only logs, then rethrow the
 * ORIGINAL error.
 *
 * `createDownloadUrl` / `delete` load the row by `{ id, tenantId, deletedAt:
 * null }` first and re-verify the deal from the LOADED row's `dealId` — never
 * a client-supplied id, or a `SALES_REP` with OWN visibility could read a
 * colleague's attachments by guessing an id.
 */
@Injectable()
export class DealDocumentsService {
  private readonly logger = new Logger(DealDocumentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly deals: DealsService,
    private readonly storage: SupabaseStorageService,
  ) {}

  async upload(
    tenantId: string,
    userId: string,
    dealId: string,
    file: Express.Multer.File,
  ): Promise<Record<string, unknown>> {
    const detected = detectDocumentType(file.originalname, file.mimetype, file.buffer)
    if (!detected) {
      throw new BadRequestException('Unsupported file type. Allowed: PDF, DOCX, XLSX, PNG, JPG')
    }

    // Verify deal access BEFORE touching storage — an invisible deal must not
    // consume storage writes.
    await this.deals.findOne(tenantId, userId, dealId)

    const documentId = randomUUID()
    const fileName = sanitizeFileName(file.originalname)
    const storagePath = `deals/${tenantId}/${dealId}/${documentId}-${fileName}`

    await this.storage.upload(storagePath, file.buffer, detected.mimeType)

    try {
      return await this.prisma.dealDocument.create({
        data: {
          id: documentId,
          tenantId,
          dealId,
          fileName,
          storagePath,
          fileSize: file.size,
          mimeType: detected.mimeType,
          uploadedBy: userId,
          createdBy: userId,
          updatedBy: userId,
        },
        include: DOCUMENT_INCLUDE,
      })
    } catch (error) {
      // Orphaned object: best-effort cleanup, never mask the original error.
      this.logger.error(`DealDocument row insert failed for ${storagePath}`)
      await this.storage.remove(storagePath).catch(() => {})
      throw error
    }
  }

  async findManyForDeal(
    tenantId: string,
    userId: string,
    dealId: string,
  ): Promise<Record<string, unknown>[]> {
    await this.deals.findOne(tenantId, userId, dealId)

    return this.prisma.dealDocument.findMany({
      where: { tenantId, dealId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: DOCUMENT_INCLUDE,
    })
  }

  async createDownloadUrl(tenantId: string, userId: string, id: string): Promise<string> {
    const document = await this.prisma.dealDocument.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!document) {
      throw new NotFoundException('Document not found')
    }

    // Re-verify the deal from the loaded row — a client-supplied dealId must
    // never be trusted here.
    await this.deals.findOne(tenantId, userId, document.dealId)

    return this.storage.createSignedUrl(document.storagePath, SIGNED_URL_TTL_SECONDS)
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    const document = await this.prisma.dealDocument.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!document) {
      throw new NotFoundException('Document not found')
    }

    await this.deals.findOne(tenantId, userId, document.dealId)

    await this.prisma.dealDocument.updateMany({
      where: { id: document.id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    // Hard-remove the object. A failure is logged and swallowed — the row is
    // already gone from the user's view, and a retained object is a cost
    // problem, not a correctness one. (Consequence: a soft-deleted document is
    // not restorable; recorded in the deferred-work ledger.)
    try {
      await this.storage.remove(document.storagePath)
    } catch (error) {
      this.logger.error(`Storage removal failed for ${document.storagePath}`)
    }

    return true
  }
}
