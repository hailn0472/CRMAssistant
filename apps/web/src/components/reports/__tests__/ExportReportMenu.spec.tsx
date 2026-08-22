import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { ExportReportMenu } from '../ExportReportMenu'
import * as exportService from '@/services/report-export.service'
import * as browserDownload from '@/lib/browser-download'

jest.mock('@/services/report-export.service', () => ({
  ...jest.requireActual('@/services/report-export.service'),
  exportReport: jest.fn(),
  getReportExportDownloadUrl: jest.fn(),
}))

jest.mock('@/lib/browser-download', () => ({
  ...jest.requireActual('@/lib/browser-download'),
  downloadFileFromUrl: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockedExportReport = exportService.exportReport as jest.MockedFunction<
  typeof exportService.exportReport
>

const mockedGetDownloadUrl = exportService.getReportExportDownloadUrl as jest.MockedFunction<
  typeof exportService.getReportExportDownloadUrl
>

const mockedDownloadFileFromUrl = browserDownload.downloadFileFromUrl as jest.MockedFunction<
  typeof browserDownload.downloadFileFromUrl
>

describe('ExportReportMenu', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    jest.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    mockedDownloadFileFromUrl.mockResolvedValue(undefined)
  })

  function renderMenu(props: Partial<React.ComponentProps<typeof ExportReportMenu>> = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <ExportReportMenu reportId="rep-123" reportName="Q3 Sales" {...props} />
      </QueryClientProvider>,
    )
  }

  it('renders export trigger button when reportId is provided', () => {
    renderMenu()
    const btn = screen.getByRole('button', { name: /export report/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })

  it('renders disabled button with tooltip wrapper when disabledReason is given', () => {
    renderMenu({
      disabled: true,
      disabledReason: 'Save report draft first before exporting',
    })
    const btn = screen.getByRole('button', { name: /export report/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText('Save report draft first before exporting')).toBeInTheDocument()
  })

  it('opens menu with PDF, Excel, and CSV options', async () => {
    renderMenu()
    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    expect(await screen.findByText('PDF Document')).toBeInTheDocument()
    expect(screen.getByText('Excel (.xlsx)')).toBeInTheDocument()
    expect(screen.getByText('CSV Plain')).toBeInTheDocument()
  })

  it('executes exportReport mutation on format select and triggers download on READY status', async () => {
    mockedExportReport.mockResolvedValueOnce({
      id: 'exp-1',
      sourceType: 'SAVED_REPORT',
      status: 'READY',
      format: 'PDF',
      filterSummary: 'All time',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'Q3_Sales.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 1024,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:05Z',
      report: { id: 'rep-123', name: 'Q3 Sales', type: 'SALES_OVERVIEW' },
    })

    mockedGetDownloadUrl.mockResolvedValueOnce({
      url: 'https://storage.supabase.co/signed/reports/123/file.pdf',
      expiresAt: '2026-08-19T10:00:00Z',
    })

    renderMenu({ filters: { datePreset: 'THIS_MONTH' } })

    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    const pdfOption = await screen.findByText('PDF Document')
    fireEvent.click(pdfOption)

    await waitFor(() => {
      expect(mockedExportReport).toHaveBeenCalledWith('rep-123', 'PDF', {
        datePreset: 'THIS_MONTH',
      })
      expect(mockedGetDownloadUrl).toHaveBeenCalledWith('exp-1')
      expect(mockedDownloadFileFromUrl).toHaveBeenCalledWith({
        url: 'https://storage.supabase.co/signed/reports/123/file.pdf',
        filename: 'Q3_Sales.pdf',
        fallbackFilename: 'Q3 Sales.pdf',
      })
      expect(toast.success).toHaveBeenCalledWith('Export ready: downloading PDF...')
    })
  })

  it('handles READY download URL fetch error without router push and shows single toast', async () => {
    mockedExportReport.mockResolvedValueOnce({
      id: 'exp-1',
      sourceType: 'SAVED_REPORT',
      status: 'READY',
      format: 'PDF',
      filterSummary: 'All time',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'Q3_Sales.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 1024,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:05Z',
      report: { id: 'rep-123', name: 'Q3 Sales', type: 'SALES_OVERVIEW' },
    })

    mockedGetDownloadUrl.mockRejectedValueOnce(new Error('Storage unavailable'))

    renderMenu()

    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    const pdfOption = await screen.findByText('PDF Document')
    fireEvent.click(pdfOption)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Export ready, but failed to fetch download URL. See export history.',
      )
      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  it('handles blob download failure without router push and shows single toast', async () => {
    mockedExportReport.mockResolvedValueOnce({
      id: 'exp-1',
      sourceType: 'SAVED_REPORT',
      status: 'READY',
      format: 'PDF',
      filterSummary: 'All time',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'Q3_Sales.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 1024,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:05Z',
      report: { id: 'rep-123', name: 'Q3 Sales', type: 'SALES_OVERVIEW' },
    })

    mockedGetDownloadUrl.mockResolvedValueOnce({
      url: 'https://storage.supabase.co/signed/reports/123/file.pdf',
      expiresAt: '2026-08-19T10:00:00Z',
    })

    mockedDownloadFileFromUrl.mockRejectedValueOnce(
      new browserDownload.BrowserDownloadError('Download request failed with status 403', {
        code: 'HTTP_ERROR',
        status: 403,
      }),
    )

    renderMenu()

    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    const pdfOption = await screen.findByText('PDF Document')
    fireEvent.click(pdfOption)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to download export file. See export history.',
      )
      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  it('shows queued toast when export returns PENDING or PROCESSING', async () => {
    mockedExportReport.mockResolvedValueOnce({
      id: 'exp-2',
      sourceType: 'SAVED_REPORT',
      status: 'PENDING',
      format: 'EXCEL',
      filterSummary: 'All time',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: null,
      contentType: null,
      fileSizeBytes: null,
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: null,
      report: { id: 'rep-123', name: 'Q3 Sales', type: 'CUSTOM' },
    })

    renderMenu()

    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    const excelOption = await screen.findByText('Excel (.xlsx)')
    fireEvent.click(excelOption)

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Export queued in background'),
        expect.any(Object),
      )
      expect(screen.queryByText('Exporting EXCEL...')).not.toBeInTheDocument()
      expect(screen.queryByText('Excel (.xlsx)')).not.toBeInTheDocument()
      expect(mockedGetDownloadUrl).not.toHaveBeenCalled()
    })
  })

  it('shows actionable error toast when export returns FAILED', async () => {
    mockedExportReport.mockResolvedValueOnce({
      id: 'exp-3',
      sourceType: 'SAVED_REPORT',
      status: 'FAILED',
      format: 'CSV',
      filterSummary: 'All time',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: null,
      contentType: null,
      fileSizeBytes: null,
      attemptCount: 1,
      errorCode: 'ROW_LIMIT_EXCEEDED',
      errorMessage: 'Export exceeds 50,000 rows limit',
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:01Z',
      report: { id: 'rep-123', name: 'Q3 Sales', type: 'SALES_OVERVIEW' },
    })

    renderMenu()

    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    const csvOption = await screen.findByText('CSV Plain')
    fireEvent.click(csvOption)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Export exceeds 50,000 rows limit'),
        expect.any(Object),
      )
      expect(screen.queryByText('Exporting CSV...')).not.toBeInTheDocument()
      expect(screen.queryByText('CSV Plain')).not.toBeInTheDocument()
      expect(mockedGetDownloadUrl).not.toHaveBeenCalled()
    })
  })

  it('clears the direct activity export loading state before waiting for the READY download', async () => {
    let resolveDownloadUrl: ((download: { url: string; expiresAt: string }) => void) | undefined
    const downloadUrlPromise = new Promise<{ url: string; expiresAt: string }>((resolve) => {
      resolveDownloadUrl = resolve
    })
    const mockOnExport = jest.fn().mockResolvedValue({
      id: 'exp-act-ready',
      sourceType: 'ACTIVITY_REPORT',
      status: 'READY',
      format: 'PDF',
      filterSummary: '2026-08-01 to 2026-08-22',
      dateRangeStart: '2026-08-01',
      dateRangeEnd: '2026-08-22',
      filename: 'activity_report.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 2048,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-22T10:00:00Z',
      completedAt: '2026-08-22T10:00:02Z',
      report: null,
    })
    mockedGetDownloadUrl.mockReturnValueOnce(downloadUrlPromise)

    render(
      <QueryClientProvider client={queryClient}>
        <ExportReportMenu
          onExport={mockOnExport}
          supportedFormats={['PDF', 'EXCEL']}
          reportName="Activity Report"
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /export report/i }))
    fireEvent.click(await screen.findByText('PDF Document'))

    await waitFor(() => {
      expect(mockOnExport).toHaveBeenCalledWith('PDF')
      expect(screen.queryByText('Exporting PDF...')).not.toBeInTheDocument()
      expect(screen.queryByText('PDF Document')).not.toBeInTheDocument()
      expect(mockedDownloadFileFromUrl).not.toHaveBeenCalled()
    })

    resolveDownloadUrl?.({
      url: 'https://storage.example.com/activity.pdf',
      expiresAt: '2026-08-23T10:00:00Z',
    })

    await waitFor(() => {
      expect(mockedDownloadFileFromUrl).toHaveBeenCalledWith({
        url: 'https://storage.example.com/activity.pdf',
        filename: 'activity_report.pdf',
        fallbackFilename: 'Activity Report.pdf',
      })
      expect(toast.success).toHaveBeenCalledWith('Export ready: downloading PDF...')
    })
  })

  it('supports custom onExport callback and supportedFormats filtering (Story 6.8)', async () => {
    const mockOnExport = jest.fn().mockResolvedValue({
      id: 'exp-act-1',
      sourceType: 'ACTIVITY_REPORT',
      status: 'READY',
      format: 'PDF',
      filterSummary: '2026-08-01 to 2026-08-22',
      dateRangeStart: '2026-08-01',
      dateRangeEnd: '2026-08-22',
      filename: 'activity_report.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 2048,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-22T10:00:00Z',
      completedAt: '2026-08-22T10:00:02Z',
      report: null,
    })

    mockedGetDownloadUrl.mockResolvedValueOnce({
      url: 'https://storage.example.com/act.pdf',
      expiresAt: '2026-08-23T10:00:00Z',
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ExportReportMenu
          onExport={mockOnExport}
          supportedFormats={['PDF', 'EXCEL']}
          reportName="Activity Report"
        />
      </QueryClientProvider>,
    )

    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    expect(await screen.findByText('PDF Document')).toBeInTheDocument()
    expect(screen.getByText('Excel (.xlsx)')).toBeInTheDocument()
    expect(screen.queryByText('CSV Plain')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('PDF Document'))

    await waitFor(() => {
      expect(mockOnExport).toHaveBeenCalledWith('PDF')
      expect(mockedGetDownloadUrl).toHaveBeenCalledWith('exp-act-1')
      expect(mockedDownloadFileFromUrl).toHaveBeenCalled()
    })
  })

  it('handles mutation rejection error', async () => {
    mockedExportReport.mockRejectedValueOnce(new Error('Network error on mutation'))

    renderMenu()

    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    const pdfOption = await screen.findByText('PDF Document')
    fireEvent.click(pdfOption)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Network error on mutation')
    })
  })
})
