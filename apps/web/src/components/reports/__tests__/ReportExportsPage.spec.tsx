import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { ReportExportsPage } from '../ReportExportsPage'
import * as exportService from '@/services/report-export.service'
import * as permissionHook from '@/hooks/usePermission'
import * as browserDownload from '@/lib/browser-download'

jest.mock('@/services/report-export.service', () => ({
  ...jest.requireActual('@/services/report-export.service'),
  getReportExports: jest.fn(),
  getReportExport: jest.fn(),
  getReportExportDownloadUrl: jest.fn(),
  deleteReportExport: jest.fn(),
}))

jest.mock('@/lib/browser-download', () => ({
  ...jest.requireActual('@/lib/browser-download'),
  downloadFileFromUrl: jest.fn(),
}))

jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
  __esModule: true,
  default: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
  }),
}))

const mockReplace = jest.fn()
let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}))

const mockedGetReportExports = exportService.getReportExports as jest.MockedFunction<
  typeof exportService.getReportExports
>

const mockedGetReportExport = exportService.getReportExport as jest.MockedFunction<
  typeof exportService.getReportExport
>

const mockedGetDownloadUrl = exportService.getReportExportDownloadUrl as jest.MockedFunction<
  typeof exportService.getReportExportDownloadUrl
>
const mockedDeleteReportExport = exportService.deleteReportExport as jest.MockedFunction<
  typeof exportService.deleteReportExport
>

const mockedDownloadFileFromUrl = browserDownload.downloadFileFromUrl as jest.MockedFunction<
  typeof browserDownload.downloadFileFromUrl
>

const mockedUseMyPermissions = permissionHook.useMyPermissions as jest.MockedFunction<
  typeof permissionHook.useMyPermissions
>

describe('ReportExportsPage', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    mockedDownloadFileFromUrl.mockResolvedValue(undefined)

    mockedUseMyPermissions.mockReturnValue({
      hasPermission: () => true,
      isLoading: false,
      permissions: [],
    } as any)
  })

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ReportExportsPage />
      </QueryClientProvider>,
    )
  }

  it('renders loading skeleton while permissions are loading', () => {
    mockedUseMyPermissions.mockReturnValueOnce({
      hasPermission: () => false,
      isLoading: true,
      permissions: [],
    } as any)

    renderPage()
    expect(screen.getByTestId('exports-loading-skeleton')).toBeInTheDocument()
  })

  it('renders permission limited state when user lacks REPORT:READ', () => {
    mockedUseMyPermissions.mockReturnValueOnce({
      hasPermission: () => false,
      isLoading: false,
      permissions: [],
    } as any)

    renderPage()
    expect(
      screen.getByText('You do not have permission to view export history.'),
    ).toBeInTheDocument()
  })

  it('renders error state on query failure and allows retry', async () => {
    mockedGetReportExports.mockRejectedValueOnce(new Error('Database unavailable'))

    renderPage()

    expect(await screen.findByText('Could not load export history')).toBeInTheDocument()
    expect(screen.getByText('Database unavailable')).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: /try again/i })
    mockedGetReportExports.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    fireEvent.click(retryBtn)
  })

  it('renders empty state when there are no exports', async () => {
    mockedGetReportExports.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    renderPage()

    expect(await screen.findByText('No export records found')).toBeInTheDocument()
    expect(screen.getByTestId('size-warning-banner')).toBeInTheDocument()
  })

  it('renders export list across table with status, size and action buttons', async () => {
    const mockItems = [
      {
        id: 'exp-ready',
        status: 'READY' as const,
        format: 'PDF' as const,
        filterSummary: 'This month',
        dateRangeStart: '2026-08-01',
        dateRangeEnd: '2026-08-31',
        filename: 'sales_overview_2026-08.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: 1048576,
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-18T10:00:00Z',
        completedAt: '2026-08-18T10:00:05Z',
        report: { id: 'rep-1', name: 'Sales Overview', type: 'SALES_OVERVIEW' },
      },
      {
        id: 'exp-failed',
        status: 'FAILED' as const,
        format: 'EXCEL' as const,
        filterSummary: 'All time',
        dateRangeStart: null,
        dateRangeEnd: null,
        filename: 'custom_huge.xlsx',
        contentType: null,
        fileSizeBytes: null,
        attemptCount: 1,
        errorCode: 'FILE_TOO_LARGE',
        errorMessage: 'Export exceeds 50MB safety limit.',
        createdAt: '2026-08-18T09:30:00Z',
        completedAt: '2026-08-18T09:30:05Z',
        report: { id: 'rep-2', name: 'Huge Report', type: 'CUSTOM' },
      },
      {
        id: 'exp-processing',
        status: 'PROCESSING' as const,
        format: 'CSV' as const,
        filterSummary: 'Q3 Deals',
        dateRangeStart: null,
        dateRangeEnd: null,
        filename: 'deals.csv',
        contentType: null,
        fileSizeBytes: 500,
        attemptCount: 0,
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-18T09:00:00Z',
        completedAt: null,
        report: null,
      },
      {
        id: 'exp-pending',
        status: 'PENDING' as const,
        format: 'PDF' as const,
        filterSummary: 'Pending Summary',
        dateRangeStart: null,
        dateRangeEnd: null,
        filename: null,
        contentType: null,
        fileSizeBytes: null,
        attemptCount: 0,
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-18T08:00:00Z',
        completedAt: null,
        report: null,
      },
    ]

    mockedGetReportExports.mockResolvedValueOnce({
      items: mockItems,
      total: 4,
      page: 1,
      pageSize: 20,
    })

    renderPage()

    expect(await screen.findAllByText('sales_overview_2026-08.pdf')).toHaveLength(2)
    expect(screen.getAllByText('custom_huge.xlsx')).toHaveLength(2)
    expect(screen.getAllByText('1.00 MB')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Ready')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Failed')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Processing')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Queued')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Export exceeds 50MB safety limit.')[0]).toBeInTheDocument()

    // Test filter tabs
    fireEvent.click(screen.getByRole('button', { name: /ready \(1\)/i }))
    expect(screen.queryByText('custom_huge.xlsx')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /processing \(2\)/i }))
    expect(screen.getAllByText('deals.csv')[0]).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /failed \(1\)/i }))
    expect(screen.getAllByText('custom_huge.xlsx')[0]).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /all statuses \(4\)/i }))
    expect(screen.getAllByText('sales_overview_2026-08.pdf')[0]).toBeInTheDocument()

    // Test format filter
    const formatSelect = screen.getByLabelText(/filter by format/i)
    fireEvent.change(formatSelect, { target: { value: 'EXCEL' } })
    expect(screen.queryByText('sales_overview_2026-08.pdf')).not.toBeInTheDocument()
    expect(screen.getAllByText('custom_huge.xlsx')[0]).toBeInTheDocument()

    fireEvent.change(formatSelect, { target: { value: 'ALL' } })

    // Test search filter
    const searchInput = screen.getByLabelText(/search exports/i)
    fireEvent.change(searchInput, { target: { value: 'sales_overview' } })
    expect(screen.getAllByText('sales_overview_2026-08.pdf')[0]).toBeInTheDocument()
    expect(screen.queryByText('custom_huge.xlsx')).not.toBeInTheDocument()

    fireEvent.change(searchInput, { target: { value: '' } })
  })

  it('triggers download when Download button is clicked for a READY item', async () => {
    const mockReadyItem = {
      id: 'exp-ready-1',
      status: 'READY' as const,
      format: 'CSV' as const,
      filterSummary: 'Default',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'deals.csv',
      contentType: 'text/csv',
      fileSizeBytes: 512,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:02Z',
      report: { id: 'rep-3', name: 'Deals', type: 'CUSTOM' },
    }

    mockedGetReportExports.mockResolvedValueOnce({
      items: [mockReadyItem],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    mockedGetDownloadUrl.mockResolvedValueOnce({
      url: 'https://storage.supabase.co/signed/reports/123/deals.csv',
      expiresAt: '2026-08-19T10:00:00Z',
    })

    renderPage()

    const downloadButtons = await screen.findAllByRole('button', {
      name: /download deals\.csv/i,
    })
    fireEvent.click(downloadButtons[0])

    await waitFor(() => {
      expect(mockedGetDownloadUrl).toHaveBeenCalledWith('exp-ready-1')
      expect(mockedDownloadFileFromUrl).toHaveBeenCalledWith({
        url: 'https://storage.supabase.co/signed/reports/123/deals.csv',
        filename: 'deals.csv',
        fallbackFilename: 'Deals.csv',
      })
      expect(toast.success).toHaveBeenCalledWith('Downloading deals.csv...')
    })
  })

  it('handles signed URL minting error gracefully', async () => {
    const mockReadyItem = {
      id: 'exp-ready-err',
      status: 'READY' as const,
      format: 'CSV' as const,
      filterSummary: 'Default',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'deals.csv',
      contentType: 'text/csv',
      fileSizeBytes: 512,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:02Z',
      report: { id: 'rep-3', name: 'Deals', type: 'CUSTOM' },
    }

    mockedGetReportExports.mockResolvedValueOnce({
      items: [mockReadyItem],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    mockedGetDownloadUrl.mockRejectedValueOnce(new Error('Signed URL expired'))

    renderPage()

    const downloadButtons = await screen.findAllByRole('button', {
      name: /download deals\.csv/i,
    })
    fireEvent.click(downloadButtons[0])

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Signed URL expired')
    })
  })

  it('handles blob fetch/download error with exactly one actionable toast', async () => {
    const mockReadyItem = {
      id: 'exp-ready-blob-err',
      status: 'READY' as const,
      format: 'CSV' as const,
      filterSummary: 'Default',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'deals.csv',
      contentType: 'text/csv',
      fileSizeBytes: 512,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:02Z',
      report: { id: 'rep-3', name: 'Deals', type: 'CUSTOM' },
    }

    mockedGetReportExports.mockResolvedValueOnce({
      items: [mockReadyItem],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    mockedGetDownloadUrl.mockResolvedValueOnce({
      url: 'https://storage.supabase.co/signed/reports/123/deals.csv',
      expiresAt: '2026-08-19T10:00:00Z',
    })

    mockedDownloadFileFromUrl.mockRejectedValueOnce(
      new browserDownload.BrowserDownloadError('Download request failed with status 403', {
        code: 'HTTP_ERROR',
        status: 403,
      }),
    )

    renderPage()

    const downloadButtons = await screen.findAllByRole('button', {
      name: /download deals\.csv/i,
    })
    fireEvent.click(downloadButtons[0])

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Download request failed with status 403')
    })
  })

  it('opens delete confirmation modal and executes deleteReportExport', async () => {
    const mockItem = {
      id: 'exp-del',
      status: 'READY' as const,
      format: 'PDF' as const,
      filterSummary: 'Default',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'to_delete.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 256,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:02Z',
      report: null,
    }

    mockedGetReportExports.mockResolvedValueOnce({
      items: [mockItem],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    mockedDeleteReportExport.mockResolvedValueOnce(true)

    renderPage()

    const deleteButtons = await screen.findAllByRole('button', {
      name: /delete export to_delete\.pdf/i,
    })
    fireEvent.click(deleteButtons[0])

    expect(await screen.findByText('Delete Export History')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: 'Delete Export' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockedDeleteReportExport).toHaveBeenCalledWith('exp-del')
      expect(toast.success).toHaveBeenCalledWith('Export history deleted')
    })
  })

  it('handles delete failure with toast error', async () => {
    const mockItem = {
      id: 'exp-del-fail',
      status: 'READY' as const,
      format: 'PDF' as const,
      filterSummary: 'Default',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'to_delete.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 256,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:02Z',
      report: null,
    }

    mockedGetReportExports.mockResolvedValueOnce({
      items: [mockItem],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    mockedDeleteReportExport.mockRejectedValueOnce(new Error('Permission denied'))

    renderPage()

    const deleteButtons = await screen.findAllByRole('button', {
      name: /delete export to_delete\.pdf/i,
    })
    fireEvent.click(deleteButtons[0])

    const confirmBtn = screen.getByRole('button', { name: 'Delete Export' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Permission denied')
    })
  })

  it('processes ?download=<id> query parameter exactly once and clears URL', async () => {
    mockSearchParams = new URLSearchParams('download=exp-auto-1')

    const mockItem = {
      id: 'exp-auto-1',
      status: 'READY' as const,
      format: 'PDF' as const,
      filterSummary: 'Default',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'auto_download.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 1024,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:02Z',
      report: null,
    }

    mockedGetReportExports.mockResolvedValueOnce({
      items: [mockItem],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    mockedGetDownloadUrl.mockResolvedValueOnce({
      url: 'https://storage.supabase.co/signed/reports/123/auto_download.pdf',
      expiresAt: '2026-08-19T10:00:00Z',
    })

    renderPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/reports/exports', { scroll: false })
      expect(mockedGetDownloadUrl).toHaveBeenCalledWith('exp-auto-1')
      expect(mockedDownloadFileFromUrl).toHaveBeenCalledWith({
        url: 'https://storage.supabase.co/signed/reports/123/auto_download.pdf',
        filename: 'auto_download.pdf',
        fallbackFilename: 'report.pdf',
      })
      expect(toast.success).toHaveBeenCalledWith('Downloading auto_download.pdf...')
    })
  })

  it('fetches off-page item via getReportExport when ?download=<id> is not in current list page (Contract E35 / M3)', async () => {
    mockSearchParams = new URLSearchParams('download=exp-offpage-1')

    mockedGetReportExports.mockResolvedValueOnce({
      items: [], // empty or page 1 doesn't have it
      total: 0,
      page: 1,
      pageSize: 20,
    })

    const mockOffPageItem = {
      id: 'exp-offpage-1',
      status: 'READY' as const,
      format: 'EXCEL' as const,
      filterSummary: 'Default',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'offpage.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSizeBytes: 2048,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:02Z',
      report: null,
    }

    mockedGetReportExport.mockResolvedValueOnce(mockOffPageItem)
    mockedGetDownloadUrl.mockResolvedValueOnce({
      url: 'https://storage.supabase.co/signed/reports/123/offpage.xlsx',
      expiresAt: '2026-08-19T10:00:00Z',
    })

    renderPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/reports/exports', { scroll: false })
      expect(mockedGetReportExport).toHaveBeenCalledWith('exp-offpage-1')
      expect(mockedGetDownloadUrl).toHaveBeenCalledWith('exp-offpage-1')
      expect(mockedDownloadFileFromUrl).toHaveBeenCalledWith({
        url: 'https://storage.supabase.co/signed/reports/123/offpage.xlsx',
        filename: 'offpage.xlsx',
        fallbackFilename: 'report.excel',
      })
      expect(toast.success).toHaveBeenCalledWith('Downloading offpage.xlsx...')
    })
  })

  it('handles ?download=<id> error/not-found when off-page fetch fails or returns null', async () => {
    mockSearchParams = new URLSearchParams('download=exp-missing')

    mockedGetReportExports.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    mockedGetReportExport.mockRejectedValueOnce(new Error('Export not found'))

    renderPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/reports/exports', { scroll: false })
      expect(mockedGetReportExport).toHaveBeenCalledWith('exp-missing')
      expect(toast.error).toHaveBeenCalledWith('Export not found')
    })
  })

  it('handles ?download=<id> when item is FAILED or PROCESSING', async () => {
    mockSearchParams = new URLSearchParams('download=exp-failed-1')

    const mockFailedItem = {
      id: 'exp-failed-1',
      status: 'FAILED' as const,
      format: 'PDF' as const,
      filterSummary: 'Default',
      dateRangeStart: null,
      dateRangeEnd: null,
      filename: 'failed.pdf',
      contentType: null,
      fileSizeBytes: null,
      attemptCount: 1,
      errorCode: 'ROW_LIMIT',
      errorMessage: 'Exceeded rows',
      createdAt: '2026-08-18T10:00:00Z',
      completedAt: '2026-08-18T10:00:02Z',
      report: null,
    }

    mockedGetReportExports.mockResolvedValueOnce({
      items: [mockFailedItem],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    renderPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/reports/exports', { scroll: false })
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Exceeded rows'))
    })
  })

  it('handles pagination controls when total exceeds pageSize', async () => {
    mockedGetReportExports.mockResolvedValue({
      items: [
        {
          id: 'exp-p1',
          status: 'READY' as const,
          format: 'PDF' as const,
          filterSummary: 'Default',
          dateRangeStart: null,
          dateRangeEnd: null,
          filename: 'p1.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 1024,
          attemptCount: 1,
          errorCode: null,
          errorMessage: null,
          createdAt: '2026-08-18T10:00:00Z',
          completedAt: '2026-08-18T10:00:02Z',
          report: null,
        },
      ],
      total: 50,
      page: 1,
      pageSize: 20,
    })

    renderPage()

    expect(await screen.findByText(/showing 1-20 of 50 export records/i)).toBeInTheDocument()

    const nextBtn = screen.getByRole('button', { name: 'Next' })
    const prevBtn = screen.getByRole('button', { name: 'Previous' })

    expect(prevBtn).toBeDisabled()
    expect(nextBtn).not.toBeDisabled()

    fireEvent.click(nextBtn)

    await waitFor(() => {
      expect(mockedGetReportExports).toHaveBeenCalledWith({ page: 2, pageSize: 20 })
    })
  })
})
