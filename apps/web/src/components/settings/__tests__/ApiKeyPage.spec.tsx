import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateApiKeyDialog } from '../CreateApiKeyDialog'
import * as apiKeyService from '@/services/api-key.service'

// Mock the API service
jest.mock('@/services/api-key.service', () => ({
  createApiKey: jest.fn(),
}))

const mockCreateApiKey = apiKeyService.createApiKey as jest.Mock

function renderWithProviders(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CreateApiKeyDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the create form when open', () => {
    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={jest.fn()} />)

    expect(screen.getByText('Create API Key')).toBeInTheDocument()
    expect(screen.getByText('Create Key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/production integration/i)).toBeInTheDocument()
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

    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={jest.fn()} />)

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

    renderWithProviders(<CreateApiKeyDialog open={true} onOpenChange={jest.fn()} />)

    const input = screen.getByPlaceholderText(/production integration/i)
    fireEvent.change(input, { target: { value: 'Test Key' } })

    fireEvent.click(screen.getByText('Create Key'))

    await waitFor(() => {
      expect(screen.getByText('Creation failed')).toBeInTheDocument()
    })
  })
})
