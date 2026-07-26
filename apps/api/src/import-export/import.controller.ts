import {
  Body,
  Controller,
  Get,
  MaxFileSizeValidator,
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
import type { ImportPreviewResponse, ImportResultResponse } from './dto/import-result.dto'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

@Controller('api/contacts')
@UseGuards(AuthGuard('jwt'))
export class ImportController {
  constructor(
    private readonly csvParserService: CsvParserService,
    private readonly importService: ImportService,
  ) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importContacts(
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Query() query: ImportQueryDto,
  ): Promise<ImportPreviewResponse | ImportResultResponse> {
    const user = req.user as JwtPayload
    const csvContent = file.buffer.toString('utf-8')
    const csvRows = this.csvParserService.parse(csvContent)

    if (query.confirm === 'true') {
      return this.importService.confirmImport(user.tenantId, user.userId, csvRows, query.strategy)
    }

    return this.importService.previewImport(user.tenantId, user.userId, csvRows)
  }

  @Get('import/preview')
  async importPreview(
    @Req() req: Request,
    @Body() body: { csvContent?: string },
  ): Promise<ImportPreviewResponse> {
    const user = req.user as JwtPayload
    const csvContent = body.csvContent ?? ''
    const csvRows = this.csvParserService.parse(csvContent)

    return this.importService.previewImport(user.tenantId, user.userId, csvRows)
  }

  @Get('import/template')
  async downloadTemplate(): Promise<{ template: string }> {
    const headers = ['email,firstName,lastName,phone,company,jobTitle,tags']
    const example = ['john@example.com,John,Doe,+84123456789,Acme Corp,CTO,"VIP,Enterprise"']
    return { template: [...headers, ...example].join('\n') }
  }
}
