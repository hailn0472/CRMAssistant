/**
 * Story 6.6 (Contract B10, C13-C14): export execution payload builder.
 *
 * Dispatches the unified Report row through the authoritative execution
 * paths (`SalesReportsService.reportData` for the six sales types,
 * `CustomReportsService.customReportData` for CUSTOM) under the REQUESTER's
 * current identity and converts typed results into the shared
 * `ReportDocumentPayload` consumed by the renderer.
 *
 * Filter snapshot semantics (Contract B10 / M7):
 * - sales: request overrides are merged over the saved config and the FULL
 *   validated effective config is persisted as the immutable snapshot.
 *   Execution replays the snapshot DIRECTLY (`reportDataWithConfig`) —
 *   never re-merged over the CURRENT saved config — so fields added or
 *   changed on the saved report after the request cannot alter export scope.
 * - custom: the saved `CustomReportConfig.filters` is authoritative; a
 *   non-empty sales-filter argument is rejected with BadRequestException and
 *   the stored snapshot stays null.
 *
 * Large custom exports page through `customReportData` in stable page order
 * (page size 100); every page must agree on columns/total or the collection
 * fails explicitly — never a silent page-1-only export.
 */
import { BadRequestException, Injectable } from '@nestjs/common'

import {
  SalesReportsService,
  type ReportRow,
  type ReportFiltersInput,
} from './sales-reports.service'
import { CustomReportsService, type CustomReportResult } from './custom-reports.service'
import type { CustomReportDataSource } from './custom-report-types'
import { parseReportConfig, validateReportConfig, type ReportConfig } from './report-config'
import { buildReportDocumentPayload, type ReportDocumentPayload } from './report-document-payload'
import { CUSTOM_EXPORT_PAGE_SIZE } from './report-export-types'
import { ExportLimitError } from './report-attachment.service'
import { customCrmUrl, salesCrmUrl } from './report-document-payload'

export type ExportExecutionResult = {
  payload: ReportDocumentPayload
  totalRows: number
  pageCount: number
}

/**
 * Merges validated request overrides over the saved config and returns the
 * FULL validated effective config (mirror of SalesReportsService.resolveConfig
 * semantics — the authoritative merge path). This normalized snapshot is what
 * gets persisted and replayed.
 */
export function normalizeSalesSnapshot(
  report: Pick<ReportRow, 'config' | 'type'>,
  filters: ReportFiltersInput | null | undefined,
  now: Date = new Date(),
): ReportConfig {
  const base = parseReportConfig(report.config, report.type)
  if (!filters) {
    return base
  }
  const merged: ReportConfig = { ...base }
  for (const key of Object.keys(filters) as (keyof ReportFiltersInput)[]) {
    const value = filters[key]
    if (value !== undefined) {
      ;(merged as unknown as Record<string, unknown>)[key] = value
    }
  }
  try {
    return validateReportConfig(merged as unknown as Record<string, unknown>, now)
  } catch (err) {
    throw new BadRequestException((err as Error).message)
  }
}

@Injectable()
export class ReportExportPayloadService {
  constructor(
    private readonly salesReportsService: SalesReportsService,
    private readonly customReportsService: CustomReportsService,
  ) {}

  /**
   * Executes page 1 under the requester's identity. For CUSTOM the result's
   * authoritative `totalRows` decides inline (<= 100) vs queued. For sales
   * the bucket result is bounded by design and inline-ready.
   *
   * `snapshot` is the FULL server-normalized effective config captured at
   * request time (Contract B10/M7): sales executes DIRECTLY from it via
   * `reportDataWithConfig` — never re-merged over the CURRENT saved config,
   * so fields added/changed later cannot alter the export scope.
   */
  async executePage1(
    tenantId: string,
    userId: string,
    report: ReportRow,
    snapshot: ReportConfig | null,
  ): Promise<ExportExecutionResult> {
    if (report.type === 'CUSTOM') {
      const result = await this.customReportsService.customReportData(tenantId, userId, report.id, {
        page: 1,
        pageSize: CUSTOM_EXPORT_PAGE_SIZE,
      })
      return {
        payload: buildReportDocumentPayload({
          report,
          customReportData: result,
          crmUrl: customCrmUrl(report.id, this.baseUrl()),
          // Page-1 probe: large customs are PARTIAL by design here — the
          // payload is only rendered inline when totalRows <= 100 (then page
          // 1 already contains every row); larger results are rebuilt by the
          // worker from the full paging pass.
          allowPartial: true,
        }),
        totalRows: result.totalRows,
        pageCount: 1,
      }
    }
    const data = snapshot
      ? await this.salesReportsService.reportDataWithConfig(tenantId, userId, report, snapshot)
      : await this.salesReportsService.reportData(tenantId, userId, report.id)
    return {
      payload: buildReportDocumentPayload({
        report,
        reportData: data,
        crmUrl: salesCrmUrl(report.id, this.baseUrl()),
      }),
      totalRows: data.current.buckets.length,
      pageCount: 1,
    }
  }

  /**
   * Executes the COMPLETE result under the requester's identity: sales in one
   * bounded call executed directly from the immutable snapshot (M7), CUSTOM
   * paged in stable order with per-page contract checks plus the persisted
   * request-time total expectation (M1/C14).
   */
  async executeFull(
    tenantId: string,
    userId: string,
    report: ReportRow,
    snapshot: ReportConfig | null,
    expectedTotalRows?: number,
  ): Promise<ExportExecutionResult> {
    if (report.type === 'CUSTOM') {
      return this.collectCustomPages(tenantId, userId, report, expectedTotalRows)
    }
    const data = snapshot
      ? await this.salesReportsService.reportDataWithConfig(tenantId, userId, report, snapshot)
      : await this.salesReportsService.reportData(tenantId, userId, report.id)
    return {
      payload: buildReportDocumentPayload({
        report,
        reportData: data,
        crmUrl: salesCrmUrl(report.id, this.baseUrl()),
      }),
      totalRows: data.current.buckets.length,
      pageCount: 1,
    }
  }

  /**
   * Contract C14: page through every custom row (stable page order, page size
   * 100). Each page must expose the same columns, config and totalRows; a
   * changing contract mid-collection is an explicit failure — never a partial
   * file marked complete.
   */
  private async collectCustomPages(
    tenantId: string,
    userId: string,
    report: ReportRow,
    expectedTotalRows?: number,
  ): Promise<ExportExecutionResult> {
    const first = await this.customReportsService.customReportData(tenantId, userId, report.id, {
      page: 1,
      pageSize: CUSTOM_EXPORT_PAGE_SIZE,
    })
    const totalRows = first.totalRows
    if (expectedTotalRows !== undefined && expectedTotalRows !== totalRows) {
      // M1/C14: the trustworthy request-time expectation no longer matches —
      // the data changed between request and execution. Terminal and typed;
      // retrying cannot succeed.
      throw new ExportLimitError(
        `Custom report row count changed between request (${expectedTotalRows}) and execution (${totalRows}); retry the export`,
        'DATA_CHANGED',
      )
    }
    const pages = Math.max(1, Math.ceil(totalRows / CUSTOM_EXPORT_PAGE_SIZE))
    const allRows = [...first.rows]
    const columns = first.columns
    const configKey = JSON.stringify(first.config)

    for (let page = 2; page <= pages; page += 1) {
      const result = await this.customReportsService.customReportData(tenantId, userId, report.id, {
        page,
        pageSize: CUSTOM_EXPORT_PAGE_SIZE,
      })
      if (result.totalRows !== totalRows) {
        throw new ExportLimitError(
          `Custom report row count changed while collecting page ${page}; retry the export`,
          'DATA_CHANGED',
        )
      }
      if (JSON.stringify(result.columns) !== JSON.stringify(columns)) {
        throw new ExportLimitError(
          `Custom report columns changed while collecting page ${page}; retry the export`,
          'DATA_CHANGED',
        )
      }
      if (JSON.stringify(result.config) !== configKey) {
        throw new ExportLimitError(
          `Custom report config changed while collecting page ${page}; retry the export`,
          'DATA_CHANGED',
        )
      }
      allRows.push(...result.rows)
    }

    if (allRows.length !== totalRows) {
      throw new ExportLimitError(
        `Custom report collected ${allRows.length} of ${totalRows} rows; retry the export`,
        'DATA_CHANGED',
      )
    }

    const fullResult: CustomReportResult = {
      ...first,
      rows: allRows,
      pagination: { page: 1, pageSize: CUSTOM_EXPORT_PAGE_SIZE, totalPages: pages },
    }
    return {
      payload: buildReportDocumentPayload({
        report,
        customReportData: fullResult,
        crmUrl: customCrmUrl(report.id, this.baseUrl()),
      }),
      totalRows,
      pageCount: pages,
    }
  }

  /** Background custom-source resolution for the source-domain read gate. */
  async resolveCustomSource(
    tenantId: string,
    userId: string,
    reportId: string,
  ): Promise<CustomReportDataSource> {
    return this.customReportsService.resolveReportDataSource(tenantId, userId, reportId)
  }

  private baseUrl(): string {
    return process.env['CRM_WEB_BASE_URL'] ?? ''
  }
}
