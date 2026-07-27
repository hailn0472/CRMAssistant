import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { PrismaModule } from '../prisma/prisma.module'
import { CsvParserService } from './csv-parser.service'
import { DuplicateDetectionService } from './duplicate-detection.service'
import { ExportController } from './export.controller'
import { ExportService } from './export.service'
import { ImportProgressStore } from './import-progress.store'
import { ImportController } from './import.controller'
import { ImportService } from './import.service'

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ImportController, ExportController],
  providers: [
    CsvParserService,
    DuplicateDetectionService,
    ImportProgressStore,
    ImportService,
    ExportService,
  ],
  exports: [CsvParserService, DuplicateDetectionService, ImportService, ExportService],
})
export class ImportExportModule {}
