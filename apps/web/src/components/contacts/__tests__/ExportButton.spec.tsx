import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ExportButton } from '../ExportButton'

// Mock the import-export service
jest.mock('@/services/import-export.service', () => ({
  exportContacts: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

import { exportContacts } from '@/services/import-export.service'
import { toast } from 'react-hot-toast'

describe('ExportButton', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Mock window.URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = jest.fn(() => 'blob:test')
    global.URL.revokeObjectURL = jest.fn()
  })

  it('renders export button with label', () => {
    render(<ExportButton />)
    expect(screen.getByText('Export CSV')).toBeInTheDocument()
  })

  it('shows loading state during export', async () => {
    const user = userEvent.setup()

    // Export never resolves during test
    ;(exportContacts as jest.Mock).mockImplementation(() => new Promise(() => {}))

    render(<ExportButton />)
    await user.click(screen.getByText('Export CSV'))

    expect(screen.getByText('Exporting...')).toBeDisabled()
  })

  it('forwards every active filter so the export matches the visible list', async () => {
    const user = userEvent.setup()
    ;(exportContacts as jest.Mock).mockResolvedValue(new Blob(['csv']))

    const filters = {
      tags: ['VIP'],
      company: 'Acme',
      jobTitle: 'CTO',
      createdAtFrom: '2026-01-01',
      createdAtTo: '2026-01-31',
    }

    render(<ExportButton filters={filters} />)
    await user.click(screen.getByText('Export CSV'))

    // Dropping jobTitle/date filters used to export far more than the user saw.
    expect(exportContacts).toHaveBeenCalledWith(filters, expect.any(AbortSignal))
  })

  it('surfaces a failure as a toast instead of failing silently', async () => {
    const user = userEvent.setup()
    ;(exportContacts as jest.Mock).mockRejectedValue(new Error('Export failed'))

    render(<ExportButton />)
    await user.click(screen.getByText('Export CSV'))

    expect(toast.error).toHaveBeenCalledWith('Export failed')
    expect(await screen.findByText('Export CSV')).toBeInTheDocument()
  })
})
