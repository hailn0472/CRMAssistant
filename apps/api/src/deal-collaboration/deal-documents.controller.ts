import {
  BadRequestException,
  Controller,
  FileValidator,
  Param,
  ParseFilePipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { FileInterceptor } from '@nestjs/platform-express'
import { Request } from 'express'

import { DealDocumentsService } from './deal-documents.service'
import { MAX_DOCUMENT_BYTES, detectDocumentType } from './file-types'
import { requirePermission } from '../common/guards/permission-check'
import { AuditService } from '../audit/audit.service'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

/**
 * Validates the upload by extension AND magic bytes. Extension + Content-Type
 * alone are not sufficient: an `.exe` renamed `contract.pdf` passes both, and
 * `detectDocumentType` is what makes AC 15 real.
 */
class DocumentFileValidator extends FileValidator<Record<string, never>> {
  constructor() {
    super({})
  }

  isValid(file?: Express.Multer.File): boolean {
    if (!file?.originalname) return false
    return detectDocumentType(file.originalname, file.mimetype, file.buffer) !== null
  }

  buildErrorMessage(): string {
    return 'Unsupported file type. Allowed: PDF, DOCX, XLSX, PNG, JPG'
  }
}

@Controller('api/deals')
@UseGuards(AuthGuard('jwt'))
export class DealDocumentsController {
  constructor(
    private readonly dealDocumentsService: DealDocumentsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Upload is a REST endpoint, not a GraphQL mutation: `graphql-upload` is not
   * installed and Story 2.1 recorded "Server must NOT accept file uploads
   * through GraphQL". If bytes never pass through the API, the API can never
   * validate them — the magic-byte check would be unenforceable.
   *
   * The size limit lives on the interceptor so multer aborts an oversized
   * upload mid-stream (HTTP 413) instead of buffering the whole body first.
   * `main.ts` sets no global body-size limit on purpose — a global limit would
   * break the existing CSV import path.
   */
  @Post(':dealId/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async uploadDocument(
    @Req() req: Request,
    @Param('dealId') dealId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new DocumentFileValidator()],
        fileIsRequired: true,
        exceptionFactory: (error) => new BadRequestException(error),
      }),
    )
    file: Express.Multer.File,
  ): Promise<Record<string, unknown>> {
    const user = req.user as JwtPayload
    // Attaching a file to a deal is a deal edit — gate on DEAL:UPDATE, exactly
    // as the line-item and deal-competitor mutations do (AC 34). No new
    // resource, no seed change.
    await requirePermission({ user }, 'DEAL', 'UPDATE')
    const document = await this.dealDocumentsService.upload(
      user.tenantId,
      user.userId,
      dealId,
      file,
    )

    // The global AuditInterceptor keys off GraphQL mutation names and never
    // fires for a REST controller — without this explicit call, the one write
    // in this story that handles user files would be the one write with no
    // audit trail (NFR9 violation).
    await this.auditService.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'DEAL',
      entityId: dealId,
      details: {
        documentId: (document as { id?: string }).id ?? 'unknown',
        fileName: (document as { fileName?: string }).fileName ?? 'unknown',
        fileSize: (document as { fileSize?: number }).fileSize ?? 0,
        mimeType: (document as { mimeType?: string }).mimeType ?? 'unknown',
      },
    })

    return document
  }
}
