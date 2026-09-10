import { Body, Controller, Post, UseGuards } from '@nestjs/common'

import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { TextToSqlQueryDto } from './dto/text-to-sql-query.dto'
import { TextToSqlExecuteDto } from './dto/text-to-sql-execute.dto'
import { TextToSqlService } from './text-to-sql.service'
import type { TextToSqlExecution, TextToSqlPreview } from './text-to-sql.types'

@Controller('ai/text-to-sql')
@UseGuards(JwtAuthGuard)
export class TextToSqlController {
  constructor(private readonly textToSqlService: TextToSqlService) {}

  @Post('preview')
  async preview(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TextToSqlQueryDto,
  ): Promise<TextToSqlPreview> {
    return this.textToSqlService.generatePreview(user, dto.question)
  }

  @Post('execute')
  async execute(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TextToSqlExecuteDto,
  ): Promise<TextToSqlExecution> {
    return this.textToSqlService.executePreview(user, dto)
  }
}
