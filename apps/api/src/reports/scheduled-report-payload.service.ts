/**
 * Story 6.5 (Contract D17-D18): scheduled-delivery payload adapter.
 *
 * Story 6.6 (Contract C13): the normalization moved into the shared
 * `report-document-payload` module consumed by BOTH the scheduled email
 * pipeline and the user-triggered export pipeline. This service keeps the
 * 6.5 dispatch surface (`buildForReport` under the schedule owner's current
 * identity) and re-exports every name the 6.5 consumers import, so no
 * call-site changes were needed.
 */
import { BadRequestException, Injectable, Optional } from '@nestjs/common'

import { SalesReportsService, type ReportData } from './sales-reports.service'
import { CustomReportsService, type CustomReportResult } from './custom-reports.service'
import type { CustomReportDataSource } from './custom-report-types'
import { isPlatformReportType } from './report-types'
import { SYSTEM_CLOCK, type Clock } from './report-schedule-types'
import {
  AttachmentLimitError,
  SCHEDULED_CUSTOM_REPORT_PAGE,
  SCHEDULED_CUSTOM_REPORT_PAGE_SIZE,
  buildReportDocumentPayload,
  customCrmUrl,
  salesCrmUrl,
  type ReportDocumentPayload,
  type ReportDocumentRow,
} from './report-document-payload'
import type { ReportRow } from './sales-reports.service'

export { AttachmentLimitError }
export {
  SCHEDULED_CUSTOM_REPORT_PAGE,
  SCHEDULED_CUSTOM_REPORT_PAGE_SIZE,
  buildReportDocumentPayload as buildScheduledReportPayload,
  salesCrmUrl,
  customCrmUrl,
}

// Compatibility aliases — Story 6.5 consumers import these names.
export type ScheduledReportPayload = ReportDocumentPayload
export type ScheduledReportSummaryMetric = ReportDocumentPayload['summaryMetrics'][number]
export type ScheduledReportColumn = ReportDocumentPayload['columns'][number]
export type ScheduledReportCell = ReportDocumentPayload['rows'][number]['cells'][number]
export type ScheduledReportRow = ReportDocumentRow
export type ScheduledReportWarning = ReportDocumentPayload['warnings'][number]

export { salesFilterSummary, exportFilename, shortIdToken } from './report-document-payload'

@Injectable()
export class ScheduledReportPayloadService {
  constructor(
    private readonly salesReportsService: SalesReportsService,
    private readonly customReportsService: CustomReportsService,
    // Injectable clock so generatedAt is deterministic in processor tests
    // (Contract E25) instead of wall-clock `new Date()`.
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
  ) {}

  /**
   * Executes the saved report under the owner's identity and builds the
   * bounded payload. `report` must already be tenant/visibility-checked.
   */
  async buildForReport(
    tenantId: string,
    ownerId: string,
    report: ReportRow,
    baseUrl: string,
  ): Promise<ScheduledReportPayload> {
    if (!isPlatformReportType(report.type)) {
      throw new BadRequestException(`Unsupported report type: ${report.type}`)
    }
    if (report.type === 'CUSTOM') {
      const result = await this.customReportsService.customReportData(
        tenantId,
        ownerId,
        report.id,
        { page: SCHEDULED_CUSTOM_REPORT_PAGE, pageSize: SCHEDULED_CUSTOM_REPORT_PAGE_SIZE },
      )
      return buildReportDocumentPayload({
        report,
        customReportData: result,
        crmUrl: customCrmUrl(report.id, baseUrl),
        now: this.clock.now(),
      })
    }
    const data = await this.salesReportsService.reportData(tenantId, ownerId, report.id)
    return buildReportDocumentPayload({
      report,
      reportData: data,
      crmUrl: salesCrmUrl(report.id, baseUrl),
      now: this.clock.now(),
    })
  }

  /** Background loader with the same owner-or-public visibility rule. */
  async loadReport(tenantId: string, ownerId: string, reportId: string): Promise<ReportRow | null> {
    try {
      return await this.salesReportsService.report(tenantId, ownerId, reportId)
    } catch {
      return null
    }
  }

  /** Background custom-source resolution for the source-domain read gate. */
  async resolveCustomSource(
    tenantId: string,
    ownerId: string,
    reportId: string,
  ): Promise<CustomReportDataSource> {
    return this.customReportsService.resolveReportDataSource(tenantId, ownerId, reportId)
  }
}

export type { ReportRow, ReportData, CustomReportResult }
