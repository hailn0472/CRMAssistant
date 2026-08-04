// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'

import { DealDocumentUpload } from '../DealDocumentUpload'
import { uploadDealDocument } from '@/services/deal-document.service'

jest.mock('@/services/deal-document.service', () => ({
  uploadDealDocument: jest.fn(),
}))

const invalidateQueries = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

function makePdfFile(name = 'contract.pdf'): File {
  return new File(['%PDF-1.7\ncontent'], name, { type: 'application/pdf' })
}

/**
 * The file input is intentionally invisible (sr-only), and userEvent.upload
 * refuses hidden elements — drive the change event directly, which is what a
 * real browser does when the hidden input receives a file.
 */
function uploadFile(file: File): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

describe('DealDocumentUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the drop zone with a visible Choose file button and hidden file input', () => {
    render(<DealDocumentUpload dealId="deal-1" />)

    expect(screen.getByText(/Drop contracts and proposals here/i)).toBeInTheDocument()
    const chooseButton = screen.getByRole('button', { name: 'Choose file' })
    expect(chooseButton).toBeInTheDocument()

    const input = document.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    expect(input).toHaveAttribute('accept', '.pdf,.docx,.xlsx,.png,.jpg,.jpeg')
    expect(input).toHaveAttribute('class', expect.stringContaining('sr-only'))
  })

  it('uploads a dropped file and raises a success toast with the file name', async () => {
    uploadDealDocument.mockResolvedValue({
      id: 'doc-1',
      dealId: 'deal-1',
      fileName: 'contract.pdf',
      fileSize: 10,
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
    })
    render(<DealDocumentUpload dealId="deal-1" />)

    const file = makePdfFile()
    const zone = screen.getByRole('button', { name: 'Attach a document' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(uploadDealDocument).toHaveBeenCalledWith('deal-1', file)
      expect(toast.success).toHaveBeenCalledWith('contract.pdf attached')
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dealDocuments', 'deal-1'] })
  })

  it('uploads through the Choose file button path', async () => {
    uploadDealDocument.mockResolvedValue({
      id: 'doc-1',
      dealId: 'deal-1',
      fileName: 'report.pdf',
      fileSize: 10,
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
    })
    render(<DealDocumentUpload dealId="deal-1" />)

    uploadFile(makePdfFile('report.pdf'))

    await waitFor(() => {
      expect(uploadDealDocument).toHaveBeenCalledWith('deal-1', expect.any(File))
      expect(toast.success).toHaveBeenCalledWith('report.pdf attached')
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dealDocuments', 'deal-1'] })
  })

  it('rejects a wrong extension with the shared validation message and never calls the service', async () => {
    render(<DealDocumentUpload dealId="deal-1" />)

    uploadFile(makePdfFile('virus.exe'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unsupported file type ".exe". Allowed: PDF, DOCX, XLSX, PNG, JPG',
      )
    })
    expect(uploadDealDocument).not.toHaveBeenCalled()
  })

  it('rejects an oversize file client-side', async () => {
    render(<DealDocumentUpload dealId="deal-1" />)

    const bigFile = new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    })
    uploadFile(bigFile)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This file is larger than the 10MB limit. Choose a smaller file.',
      )
    })
    expect(uploadDealDocument).not.toHaveBeenCalled()
  })

  it('rejects a multi-file drop', async () => {
    render(<DealDocumentUpload dealId="deal-1" />)

    const zone = screen.getByRole('button', { name: 'Attach a document' })
    fireEvent.drop(zone, { dataTransfer: { files: [makePdfFile('a.pdf'), makePdfFile('b.pdf')] } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Please drop a single file. Only one document can be attached at a time.',
      )
    })
    expect(uploadDealDocument).not.toHaveBeenCalled()
  })

  it('maps a server 413 to a too-large message in the alert panel', async () => {
    uploadDealDocument.mockRejectedValue(new Error('File too large'))
    render(<DealDocumentUpload dealId="deal-1" />)

    uploadFile(makePdfFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This file is larger than the 10MB limit. Choose a smaller file and try again.',
      )
    })
  })

  it('renders a generic alert with the server message for other failures', async () => {
    uploadDealDocument.mockRejectedValue(new Error('Backend request failed'))
    render(<DealDocumentUpload dealId="deal-1" />)

    uploadFile(makePdfFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Upload failed: Backend request failed. Check your connection and try again.',
      )
    })
  })

  it('disables the zone and button while an upload is pending', async () => {
    let resolveUpload
    uploadDealDocument.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve
      }),
    )
    render(<DealDocumentUpload dealId="deal-1" />)

    uploadFile(makePdfFile())

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Uploading...' })).toBeDisabled()
    })
    expect(screen.getByText('Uploading...')).toBeInTheDocument()

    resolveUpload({
      id: 'doc-1',
      dealId: 'deal-1',
      fileName: 'contract.pdf',
      fileSize: 10,
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
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose file' })).not.toBeDisabled()
    })
  })

  it('highlights the zone on dragOver and clears it on dragLeave', () => {
    render(<DealDocumentUpload dealId="deal-1" />)
    const zone = screen.getByRole('button', { name: 'Attach a document' })

    fireEvent.dragOver(zone)
    expect(zone.className).toContain('border-[#1b1b1f] bg-[#f7f7f8]')

    fireEvent.dragLeave(zone)
    expect(zone.className).not.toContain('border-[#1b1b1f] bg-[#f7f7f8]')
  })

  it('opens the file picker from the Choose file button and via Enter on the zone', () => {
    const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    render(<DealDocumentUpload dealId="deal-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }))
    expect(clickSpy).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Attach a document' }), { key: 'Enter' })
    expect(clickSpy).toHaveBeenCalledTimes(2)

    clickSpy.mockRestore()
  })

  it('ignores a drop while an upload is pending', async () => {
    let resolveUpload
    uploadDealDocument.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve
      }),
    )
    render(<DealDocumentUpload dealId="deal-1" />)

    uploadFile(makePdfFile())
    await waitFor(() => {
      expect(screen.getByText('Uploading...')).toBeInTheDocument()
    })

    // A second drop while pending must not start another upload.
    const zone = screen.getByRole('button', { name: 'Attach a document' })
    fireEvent.drop(zone, { dataTransfer: { files: [makePdfFile('second.pdf')] } })

    expect(uploadDealDocument).toHaveBeenCalledTimes(1)

    resolveUpload({
      id: 'doc-1',
      dealId: 'deal-1',
      fileName: 'contract.pdf',
      fileSize: 10,
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
    })
  })
})
