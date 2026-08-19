import { graphqlRequest } from '@/lib/graphql-client'

// ─── Enums & Types ─────────────────────────────────────────────

export type ReportDeliveryFormat = 'PDF' | 'EXCEL' | 'CSV'

export type ReportExportStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'

export type ReportExportReportSummary = {
  id: string
  name: string
  type: string
}

export type ReportExport = {
  id: string
  status: ReportExportStatus
  format: ReportDeliveryFormat
  filterSummary: string
  dateRangeStart: string | null
  dateRangeEnd: string | null
  filename: string | null
  contentType: string | null
  fileSizeBytes: number | null
  attemptCount: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  report: ReportExportReportSummary | null
}

export type ReportExportConnection = {
  items: ReportExport[]
  total: number
  page: number
  pageSize: number
}

export type ReportExportDownload = {
  url: string
  expiresAt: string
}

import type { ReportFilters } from '@/services/sales-report.service'

export type ReportFiltersInput = ReportFilters

export type PaginationInput = {
  page?: number
  pageSize?: number
}

// ─── TanStack Query Keys ───────────────────────────────────────

export const reportExportKeys = {
  all: ['reportExports'] as const,
  lists: () => [...reportExportKeys.all, 'list'] as const,
  list: (params?: { page?: number; pageSize?: number }) =>
    [...reportExportKeys.lists(), params] as const,
  details: () => [...reportExportKeys.all, 'detail'] as const,
  detail: (id: string) => [...reportExportKeys.details(), id] as const,
}

// ─── GraphQL Fragments & Operations ────────────────────────────

export const REPORT_EXPORT_FIELDS = `
  id
  status
  format
  filterSummary
  dateRangeStart
  dateRangeEnd
  filename
  contentType
  fileSizeBytes
  attemptCount
  errorCode
  errorMessage
  createdAt
  completedAt
  report {
    id
    name
    type
  }
`

export const EXPORT_REPORT_MUTATION = `
  mutation ExportReport($reportId: ID!, $format: ReportDeliveryFormat!, $filters: ReportFiltersInput) {
    exportReport(reportId: $reportId, format: $format, filters: $filters) {
      ${REPORT_EXPORT_FIELDS}
    }
  }
`

export const REPORT_EXPORTS_QUERY = `
  query ReportExports($pagination: PaginationInput) {
    reportExports(pagination: $pagination) {
      items {
        ${REPORT_EXPORT_FIELDS}
      }
      total
      page
      pageSize
    }
  }
`

export const REPORT_EXPORT_QUERY = `
  query ReportExport($id: ID!) {
    reportExport(id: $id) {
      ${REPORT_EXPORT_FIELDS}
    }
  }
`

export const REPORT_EXPORT_DOWNLOAD_URL_MUTATION = `
  mutation ReportExportDownloadUrl($id: ID!) {
    reportExportDownloadUrl(id: $id) {
      url
      expiresAt
    }
  }
`

export const DELETE_REPORT_EXPORT_MUTATION = `
  mutation DeleteReportExport($id: ID!) {
    deleteReportExport(id: $id)
  }
`

// ─── Service Methods ───────────────────────────────────────────

export async function exportReport(
  reportId: string,
  format: ReportDeliveryFormat,
  filters?: ReportFiltersInput | null,
): Promise<ReportExport> {
  const data = await graphqlRequest<{ exportReport: ReportExport }>(EXPORT_REPORT_MUTATION, {
    reportId,
    format,
    filters: filters ?? undefined,
  })
  return data.exportReport
}

export async function getReportExports(
  pagination?: PaginationInput,
): Promise<ReportExportConnection> {
  const data = await graphqlRequest<{ reportExports: ReportExportConnection }>(
    REPORT_EXPORTS_QUERY,
    {
      pagination: pagination
        ? { page: pagination.page ?? undefined, pageSize: pagination.pageSize ?? undefined }
        : undefined,
    },
  )
  return data.reportExports
}

export async function getReportExport(id: string): Promise<ReportExport> {
  const data = await graphqlRequest<{ reportExport: ReportExport }>(REPORT_EXPORT_QUERY, { id })
  return data.reportExport
}

export async function getReportExportDownloadUrl(id: string): Promise<ReportExportDownload> {
  const data = await graphqlRequest<{ reportExportDownloadUrl: ReportExportDownload }>(
    REPORT_EXPORT_DOWNLOAD_URL_MUTATION,
    { id },
  )
  return data.reportExportDownloadUrl
}

export async function deleteReportExport(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteReportExport: boolean }>(
    DELETE_REPORT_EXPORT_MUTATION,
    { id },
  )
  return data.deleteReportExport
}
