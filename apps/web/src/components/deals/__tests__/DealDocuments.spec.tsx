// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { DealDocuments } from '../DealDocuments'
import {
  getDealDocuments,
  deleteDealDocument,
  getDealDocumentDownloadUrl,
  uploadDealDocument,
} from '@/services/deal-document.service'
import { usePermission } from '@/hooks/usePermission'

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/deal-document.service', () => ({
  getDealDocuments: jest.fn(),
  deleteDealDocument: jest.fn(),
  getDealDocumentDownloadUrl: jest.fn(),
  uploadDealDocument: jest.fn(),
}))

jest.mock('@/hooks/usePermission', () => ({
  usePermission: jest.fn(() => true),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockDocuments = [
  {
    id: 'doc-1',
    dealId: 'deal-1',
    fileName: 'contract.pdf',
    fileSize: 1536,
    mimeType: 'application/pdf',
    uploadedBy: 'user-1',
    createdAt: '2026-07-31T00:00:00.000Z',
    uploader: {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'a@b.c',
      avatar: null,
    },
  },
  {
    id: 'doc-2',
    dealId: 'deal-1',
    fileName: 'logo.png',
    fileSize: 1024 * 1024,
    mimeType: 'image/png',
    uploadedBy: 'user-2',
    createdAt: '2026-07-30T00:00:00.000Z',
    uploader: {
      id: 'user-2',
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'g@b.c',
      avatar: null,
    },
  },
]

function renderWithQuery(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealDocuments', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    ;(usePermission as jest.Mock).mockReturnValue(true)
  })

  it('renders the section header and caption', async () => {
    getDealDocuments.mockResolvedValue(mockDocuments)
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByText('contract.pdf')).toBeInTheDocument()
    })
    expect(screen.getByText('Documents')).toBeInTheDocument()
    expect(screen.getByText('Documents attached to this deal').tagName).toBe('CAPTION')
  })

  it('renders type, size and uploader columns', async () => {
    getDealDocuments.mockResolvedValue(mockDocuments)
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByText('PDF')).toBeInTheDocument()
    })
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('PNG')).toBeInTheDocument()
    expect(screen.getByText('1.0 MB')).toBeInTheDocument()
  })

  it('renders EmptyState when there are no documents', async () => {
    getDealDocuments.mockResolvedValue([])
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByText('No documents yet')).toBeInTheDocument()
    })
  })

  it('renders TableSkeleton while loading', () => {
    getDealDocuments.mockResolvedValue(new Promise(() => {}))
    renderWithQuery(<DealDocuments dealId="deal-1" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders ErrorState on query failure', async () => {
    getDealDocuments.mockRejectedValue(new Error('Network error'))
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load documents')).toBeInTheDocument()
    })
  })

  it('mints a signed URL and opens it on file name click', async () => {
    getDealDocuments.mockResolvedValue(mockDocuments)
    getDealDocumentDownloadUrl.mockResolvedValue('https://signed.example/doc-1')
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null)
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByText('contract.pdf')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('contract.pdf'))

    await waitFor(() => {
      expect(getDealDocumentDownloadUrl).toHaveBeenCalledWith('doc-1')
      expect(openSpy).toHaveBeenCalledWith(
        'https://signed.example/doc-1',
        '_blank',
        'noopener,noreferrer',
      )
    })
  })

  it('shows a toast when the download URL cannot be minted', async () => {
    getDealDocuments.mockResolvedValue(mockDocuments)
    getDealDocumentDownloadUrl.mockRejectedValue(new Error('boom'))
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByText('contract.pdf')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('contract.pdf'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to generate download link')
    })
  })

  it('deletes a document after confirmation and invalidates the list', async () => {
    getDealDocuments.mockResolvedValue(mockDocuments)
    deleteDealDocument.mockResolvedValue(true)
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByLabelText('Delete contract.pdf')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Delete contract.pdf'))

    await waitFor(() => {
      expect(deleteDealDocument).toHaveBeenCalledWith('doc-1')
      expect(toast.success).toHaveBeenCalledWith('Document deleted')
    })
  })

  it('shows an error toast when deletion fails', async () => {
    getDealDocuments.mockResolvedValue(mockDocuments)
    deleteDealDocument.mockRejectedValue(new Error('boom'))
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByLabelText('Delete contract.pdf')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Delete contract.pdf'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to delete document')
    })
  })

  it('hides the upload zone and delete buttons without DEAL:UPDATE', async () => {
    ;(usePermission as jest.Mock).mockReturnValue(false)
    getDealDocuments.mockResolvedValue(mockDocuments)
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByText('contract.pdf')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Delete contract.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText('Choose file')).not.toBeInTheDocument()
  })

  it('renders the upload zone for users with DEAL:UPDATE', async () => {
    getDealDocuments.mockResolvedValue([])
    renderWithQuery(<DealDocuments dealId="deal-1" />)

    await waitFor(() => {
      expect(screen.getByText('Choose file')).toBeInTheDocument()
    })
  })
})
