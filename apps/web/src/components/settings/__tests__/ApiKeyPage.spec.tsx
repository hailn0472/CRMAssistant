import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateApiKeyDialog } from '../CreateApiKeyDialog'
import * as apiKeyService from '@/services/api-key.service'
import * as permissionService from '@/services/permission.service'

// Mock the services
jest.mock('@/services/api-key.service', () => ({
  createApiKey: jest.fn(),
}))

jest.mock('@/services/permission.service', () => ({
  getMyPermissions: jest.fn(),
}))

const mockCreateApiKey = apiKeyService.createApiKey as jest.Mock
const mockGetMyPermissions = permissionService.getMyPermissions as jest.Mock

function renderWithProviders(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CreateApiKeyDialog', () => {
  const mockOnOpenChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetMyPermissions.mockResolvedValue([])
  })

  it('renders the create form when open', () => {
    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

    expect(screen.getByText('Create API Key')).toBeInTheDocument()
    expect(screen.getByText('Create Key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/production integration/i)).toBeInTheDocument()
  })

  it('does not render content when closed', () => {
    renderWithProviders(<CreateApiKeyDialog open={false} onOpenChange={mockOnOpenChange} />)

    expect(screen.queryByText('Create API Key')).not.toBeInTheDocument()
  })

  it('shows validation error when submitting with empty name', async () => {
    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

    fireEvent.click(screen.getByText('Create Key'))

    expect(screen.getByText('Name is required')).toBeInTheDocument()
  })

  it('renders the one-time key display after creation', async () => {
    mockCreateApiKey.mockResolvedValue({
      id: 'key-1',
      name: 'Test Key',
      keyPrefix: 'crm_a1b2c3d',
      fullKey: 'crm_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
      permissions: null,
      expiresAt: new Date('2026-10-01').toISOString(),
    })

    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

    // Fill in the name
    const input = screen.getByPlaceholderText(/production integration/i)
    fireEvent.change(input, { target: { value: 'Test Key' } })

    // Submit the form
    const createButton = screen.getByText('Create Key')
    fireEvent.click(createButton)

    // Wait for the key display
    await waitFor(() => {
      expect(screen.getByText('API Key Created')).toBeInTheDocument()
    })

    expect(screen.getByText("I've Saved the Key")).toBeInTheDocument()
    expect(screen.getByText('Copy to Clipboard')).toBeInTheDocument()
  })

  it('shows error message when creation fails', async () => {
    mockCreateApiKey.mockRejectedValue(new Error('Creation failed'))

    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

    const input = screen.getByPlaceholderText(/production integration/i)
    fireEvent.change(input, { target: { value: 'Test Key' } })

    fireEvent.click(screen.getByText('Create Key'))

    await waitFor(() => {
      expect(screen.getByText('Creation failed')).toBeInTheDocument()
    })
  })

  it('calls handleClose when Cancel is clicked', () => {
    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

    fireEvent.click(screen.getByText('Cancel'))

    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it('copies key to clipboard when Copy is clicked', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })

    mockCreateApiKey.mockResolvedValue({
      id: 'key-1',
      name: 'Test Key',
      keyPrefix: 'crm_test',
      fullKey: 'the-full-key-value',
      permissions: null,
      expiresAt: null,
    })

    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

    fireEvent.change(screen.getByPlaceholderText(/production integration/i), {
      target: { value: 'Test Key' },
    })
    fireEvent.click(screen.getByText('Create Key'))

    await waitFor(() => {
      expect(screen.getByText('Copy to Clipboard')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Copy to Clipboard'))

    expect(writeText).toHaveBeenCalledWith('the-full-key-value')

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('closes the dialog after saving the key', async () => {
    jest.useFakeTimers()

    mockCreateApiKey.mockResolvedValue({
      id: 'key-1',
      name: 'Test Key',
      keyPrefix: 'crm_test',
      fullKey: 'full-key',
      permissions: null,
      expiresAt: null,
    })

    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

    fireEvent.change(screen.getByPlaceholderText(/production integration/i), {
      target: { value: 'Test Key' },
    })
    fireEvent.click(screen.getByText('Create Key'))

    await waitFor(() => {
      expect(screen.getByText("I've Saved the Key")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("I've Saved the Key"))

    act(() => {
      jest.advanceTimersByTime(500)
    })

    expect(mockOnOpenChange).toHaveBeenCalledWith(false)

    jest.useRealTimers()
  })

  describe('permission scoping', () => {
    beforeEach(() => {
      mockGetMyPermissions.mockResolvedValue([
        { resource: 'contact', action: 'read', granted: true },
        { resource: 'contact', action: 'write', granted: true },
        { resource: 'deal', action: 'read', granted: false },
      ])
    })

    it('shows permission checkboxes when permissions are available', async () => {
      renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

      await waitFor(() => {
        expect(screen.getByText('contact:read')).toBeInTheDocument()
      })
      expect(screen.getByText('contact:write')).toBeInTheDocument()
      expect(screen.queryByText('deal:read')).not.toBeInTheDocument()
    })

    it('toggles permission when checkbox is clicked', async () => {
      renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

      await waitFor(() => {
        expect(screen.getByText('contact:read')).toBeInTheDocument()
      })

      const checkbox = screen.getByText('contact:read').previousElementSibling as HTMLInputElement
      expect(checkbox.checked).toBe(false)

      fireEvent.click(checkbox)
      expect(checkbox.checked).toBe(true)

      fireEvent.click(checkbox)
      expect(checkbox.checked).toBe(false)
    })

    it('passes selected permissions to createApiKey', async () => {
      mockCreateApiKey.mockResolvedValue({
        id: 'key-1',
        name: 'Scoped Key',
        keyPrefix: 'crm_scoped',
        fullKey: 'scoped-full-key',
        permissions: ['contact:read'],
        expiresAt: null,
      })

      renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={mockOnOpenChange} />)

      await waitFor(() => {
        expect(screen.getByText('contact:read')).toBeInTheDocument()
      })

      // Toggle both permissions on
      const readCheckbox = screen.getByText('contact:read')
        .previousElementSibling as HTMLInputElement
      const writeCheckbox = screen.getByText('contact:write')
        .previousElementSibling as HTMLInputElement
      fireEvent.click(readCheckbox)
      fireEvent.click(writeCheckbox)

      fireEvent.change(screen.getByPlaceholderText(/production integration/i), {
        target: { value: 'Scoped Key' },
      })
      fireEvent.click(screen.getByText('Create Key'))

      await waitFor(() => {
        expect(mockCreateApiKey).toHaveBeenCalledWith({
          name: 'Scoped Key',
          permissions: ['contact:read', 'contact:write'],
        })
      })
    })
  })
})
