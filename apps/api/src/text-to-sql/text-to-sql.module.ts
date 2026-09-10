import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { PermissionsModule } from '../permissions/permissions.module'
import { PrismaModule } from '../prisma/prisma.module'
import { GoogleAiStudioClient } from './google-ai-studio.client'
import { TextToSqlController } from './text-to-sql.controller'
import { TextToSqlService } from './text-to-sql.service'

@Module({
  imports: [AuthModule, AuditModule, PermissionsModule, PrismaModule],
  controllers: [TextToSqlController],
  providers: [GoogleAiStudioClient, TextToSqlService],
})
export class TextToSqlModule {}
