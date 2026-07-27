import {
  Controller,
  FileValidator,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { FileInterceptor } from '@nestjs/platform-express'
import { Request } from 'express'

import { CsvParserService } from './csv-parser.service'
import { ImportQueryDto } from './dto/import-result.dto'
import { ImportService } from './import.service'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import type {
  ImportPreviewResponse,
  ImportStartedResponse,
  ImportStatusResponse,
} from './dto/import-result.dto'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXTENSIONS = ['.csv', '.tsv']

/**
 * Validates the upload by extension. Browser-supplied mimetypes for CSV vary by
 * OS (`text/csv`, `application/vnd.ms-excel`, `application/octet-stream`), so the
 * extension is the reliable signal — and the parser rejects anything that is not
 * actually delimited text.
 */
class CsvFileValidator extends FileValidator<Record<string, never>> {
  constructor() {
    super({})
  }

  isValid(file?: Express.Multer.File): boolean {
    if (!file?.originalname) return false
    const name = file.originalname.toLowerCase()
    return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))
  }

  buildErrorMessage(): string {
    return `Invalid file type. Only ${ALLOWED_EXTENSIONS.join(' and ')} files are accepted.`
  }
}

@Controller('api/contacts')
@UseGuards(AuthGuard('jwt'))
export class ImportController {
  constructor(
    private readonly csvParserService: CsvParserService,
    private readonly importService: ImportService,
  ) {}

  /**
   * Without `?confirm=true` this returns a preview. With it, the import is
   * registered and runs in the background; poll `import/:importId/status`.
   *
   * The size limit lives on the interceptor so multer aborts an oversized upload
   * mid-stream (HTTP 413) instead of buffering the whole body into memory first.
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async importContacts(
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new CsvFileValidator()],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Query() query: ImportQueryDto,
  ): Promise<ImportPreviewResponse | ImportStartedResponse> {
    const user = req.user as JwtPayload
    const parsed = this.csvParserService.parse(file.buffer.toString('utf-8'))

    if (query.confirm === true) {
      return this.importService.startImport(user.tenantId, user.userId, parsed, query.strategy)
    }

    return this.importService.previewImport(user.tenantId, user.userId, parsed.rows)
  }

  @Get('import/:importId/status')
  getImportStatus(@Req() req: Request, @Param('importId') importId: string): ImportStatusResponse {
    const user = req.user as JwtPayload
    const status = this.importService.getStatus(importId, user.tenantId)

    if (!status) {
      throw new NotFoundException('Import not found or expired')
    }

    return status
  }

  @Get('import/template')
  downloadTemplate(): { template: string } {
    const headers = ['email,firstName,lastName,phone,company,jobTitle,tags']
    const example = ['john@example.com,John,Doe,+84123456789,Acme Corp,CTO,"VIP,Enterprise"']
    return { template: [...headers, ...example].join('\n') }
  }
}
