import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Response, Request } from 'express'

import { ExportService } from './export.service'
import { ExportQueryDto } from './dto/import-result.dto'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('api/contacts')
@UseGuards(AuthGuard('jwt'))
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('export')
  async exportContacts(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: ExportQueryDto,
  ): Promise<void> {
    const user = req.user as JwtPayload

    const dateStr = new Date().toISOString().split('T')[0]!
    const filename = `contacts-${dateStr}.csv`

    // Set Content-Type and Content-Disposition with RFC 5987 encoding
    // for safe handling of special characters in filenames
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    )

    const stream = await this.exportService.exportContacts(user.tenantId, user.userId, {
      tags: query.tags,
      company: query.company,
      search: query.search,
    })

    stream.pipe(res)
  }
}
