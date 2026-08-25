import {
  exportReport,
  exportActivityReport,
  getReportExports,
  getReportExport,
  getReportExportDownloadUrl,
  deleteReportExport,
  reportExportKeys,
} from '../report-export.service'
import { graphqlRequest } from '@/lib/graphql-client'

jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

const mockedGraphqlRequest = graphqlRequest as jest.MockedFunction<typeof graphqlRequest>

describe('report-export.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('reportExportKeys', () => {
    it('defines consistent query key hierarchy rooted at reportExports', () => {
      expect(reportExportKeys.all).toEqual(['reportExports'])
      expect(reportExportKeys.lists()).toEqual(['reportExports', 'list'])
      expect(reportExportKeys.list({ page: 1, pageSize: 20 })).toEqual([
        'reportExports',
        'list',
        { page: 1, pageSize: 20 },
      ])
      expect(reportExportKeys.details()).toEqual(['reportExports', 'detail'])
      expect(reportExportKeys.detail('exp-1')).toEqual(['reportExports', 'detail', 'exp-1'])
    })
  })

  describe('exportReport', () => {
    it('sends exportReport mutation with exact variables and unwraps result', async () => {
      const mockResult = {
        id: 'exp-1',
        sourceType: 'SAVED_REPORT' as const,
        status: 'READY' as const,
        format: 'PDF' as const,
        filterSummary: 'All time',
        dateRangeStart: null,
        dateRangeEnd: null,
        filename: 'sales_report.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: 1024,
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-18T10:00:00Z',
        completedAt: '2026-08-18T10:00:05Z',
        report: { id: 'rep-1', name: 'Sales Overview', type: 'SALES_OVERVIEW' },
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ exportReport: mockResult })

      const filters = { datePreset: 'THIS_MONTH' as const, ownerId: 'u1' }
      const res = await exportReport('rep-1', 'PDF', filters)

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation ExportReport'),
        {
          reportId: 'rep-1',
          format: 'PDF',
          filters,
        },
      )
      expect(res).toEqual(mockResult)
    })

    it('passes undefined filters when null/omitted', async () => {
      mockedGraphqlRequest.mockResolvedValueOnce({
        exportReport: { id: 'exp-2', sourceType: 'SAVED_REPORT', status: 'PENDING' },
      })

      await exportReport('rep-2', 'CSV', null)

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation ExportReport'),
        {
          reportId: 'rep-2',
          format: 'CSV',
          filters: undefined,
        },
      )
    })
  })

  describe('exportActivityReport', () => {
    it('sends exportActivityReport mutation with exact variables and unwraps result (Story 6.8)', async () => {
      const mockResult = {
        id: 'exp-act-1',
        sourceType: 'ACTIVITY_REPORT' as const,
        status: 'READY' as const,
        format: 'EXCEL' as const,
        filterSummary: '2026-08-01 to 2026-08-22',
        dateRangeStart: '2026-08-01',
        dateRangeEnd: '2026-08-22',
        filename: 'activity_report.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSizeBytes: 4096,
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-22T10:00:00Z',
        completedAt: '2026-08-22T10:00:02Z',
        report: null,
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ exportActivityReport: mockResult })

      const filters = {
        startDate: '2026-08-01',
        endDate: '2026-08-22',
        sortBy: 'ACTIVITIES' as const,
      }

      const res = await exportActivityReport(filters, 'EXCEL')

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation ExportActivityReport'),
        {
          filters,
          format: 'EXCEL',
        },
      )
      expect(res).toEqual(mockResult)
    })
  })

  describe('getReportExports', () => {
    it('requests reportExports with pagination and returns connection', async () => {
      const mockConn = {
        items: [
          {
            id: 'exp-1',
            sourceType: 'SAVED_REPORT' as const,
            status: 'READY' as const,
            format: 'EXCEL' as const,
            filterSummary: 'This month',
            dateRangeStart: '2026-08-01',
            dateRangeEnd: '2026-08-31',
            filename: 'custom_report.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileSizeBytes: 2048,
            attemptCount: 1,
            errorCode: null,
            errorMessage: null,
            createdAt: '2026-08-18T10:00:00Z',
            completedAt: '2026-08-18T10:00:05Z',
            report: { id: 'rep-1', name: 'Deals by Owner', type: 'CUSTOM' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ reportExports: mockConn })

      const res = await getReportExports({ page: 1, pageSize: 20 })

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query ReportExports'),
        {
          pagination: { page: 1, pageSize: 20 },
        },
      )
      expect(res).toEqual(mockConn)
    })

    it('handles undefined pagination gracefully', async () => {
      mockedGraphqlRequest.mockResolvedValueOnce({
        reportExports: { items: [], total: 0, page: 1, pageSize: 20 },
      })

      await getReportExports()

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query ReportExports'),
        {
          pagination: undefined,
        },
      )
    })
  })

  describe('getReportExport', () => {
    it('fetches a single export by id', async () => {
      const mockExport = {
        id: 'exp-1',
        sourceType: 'SAVED_REPORT' as const,
        status: 'READY' as const,
        format: 'PDF' as const,
        filterSummary: 'All time',
        dateRangeStart: null,
        dateRangeEnd: null,
        filename: 'sales_report.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: 1024,
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-18T10:00:00Z',
        completedAt: '2026-08-18T10:00:05Z',
        report: null,
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ reportExport: mockExport })

      const res = await getReportExport('exp-1')

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query ReportExport('),
        { id: 'exp-1' },
      )
      expect(res).toEqual(mockExport)
    })
  })

  describe('getReportExportDownloadUrl', () => {
    it('requests signed download url for ready export via mutation and unwraps result', async () => {
      const mockDownload = {
        url: 'https://storage.supabase.co/signed/reports/123/file.pdf?token=abc',
        expiresAt: '2026-08-19T10:00:00Z',
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ reportExportDownloadUrl: mockDownload })

      const res = await getReportExportDownloadUrl('exp-1')

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringMatching(/^\s*mutation ReportExportDownloadUrl/),
        { id: 'exp-1' },
      )
      expect(mockedGraphqlRequest).not.toHaveBeenCalledWith(
        expect.stringMatching(/^\s*query ReportExportDownloadUrl/),
        expect.anything(),
      )
      expect(res).toEqual(mockDownload)
    })
  })

  describe('deleteReportExport', () => {
    it('calls deleteReportExport mutation and returns boolean', async () => {
      mockedGraphqlRequest.mockResolvedValueOnce({ deleteReportExport: true })

      const res = await deleteReportExport('exp-1')

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation DeleteReportExport'),
        { id: 'exp-1' },
      )
      expect(res).toBe(true)
    })
  })
})
