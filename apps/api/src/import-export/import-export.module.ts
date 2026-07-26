import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { CsvParserService } from './csv-parser.service'
import { DuplicateDetectionService } from './duplicate-detection.service'
import { ExportController } from './export.controller'
import { ExportService } from './export.service'
import { ImportController } from './import.controller'
import { ImportService } from './import.service'

@Module({
  imports: [PrismaModule],
  controllers: [ImportController, ExportController],
  providers: [CsvParserService, DuplicateDetectionService, ImportService, ExportService],
  exports: [CsvParserService, DuplicateDetectionService, ImportService, ExportService],
})
export class ImportExportModule {}
