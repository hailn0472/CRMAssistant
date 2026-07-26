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
})
