import { Controller, Get, Logger, Query, Req, Res, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Response, Request } from 'express'

import { ExportService } from './export.service'
import { ExportQueryDto } from './dto/import-result.dto'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('api/contacts')
@UseGuards(AuthGuard('jwt'))
export class ExportController {
  private readonly logger = new Logger(ExportController.name)

  constructor(private readonly exportService: ExportService) {}

  @Get('export')
  async exportContacts(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: ExportQueryDto,
  ): Promise<void> {
    const user = req.user as JwtPayload

    // Build the stream first. Visibility resolution and filter construction both
    // happen here, so a failure propagates to the exception filter as clean JSON
    // while the response is still uncommitted.
    const stream = await this.exportService.exportContacts(user.tenantId, user.userId, {
      tags: query.tags,
      company: query.company,
      search: query.search,
      jobTitle: query.jobTitle,
      createdAtFrom: query.createdAtFrom,
      createdAtTo: query.createdAtTo,
    })

    const dateStr = new Date().toISOString().split('T')[0]!
    const filename = `contacts-${dateStr}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    // A failure once bytes are flowing cannot become a JSON error response, so
    // destroy the connection: the client sees an aborted transfer rather than a
    // truncated file that looks complete.
    stream.on('error', (error: Error) => {
      this.logger.error(`Contact export stream failed: ${error.message}`)
      res.destroy(error)
    })

    stream.pipe(res)
  }
}
