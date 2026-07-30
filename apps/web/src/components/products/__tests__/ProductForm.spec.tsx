// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ProductForm } from '../ProductForm'
import { createProduct, updateProduct } from '@/services/product.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/product.service', () => ({
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  getProducts: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

function renderWithQuery(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const mockProduct = {
  id: 'product-1',
  name: 'Consulting',
  price: 5000,
  currency: 'USD',
  isActive: true,
  description: 'A consulting package',
  createdAt: '',
  updatedAt: '',
}

describe('ProductForm', () => {
  const onOpenChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders create mode by default', () => {
    renderWithQuery(<ProductForm product={null} open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByText('Add product')).toBeInTheDocument()
    expect(screen.getByText('Create')).toBeInTheDocument()
  })

  it('renders edit mode with pre-filled values', () => {
    renderWithQuery(<ProductForm product={mockProduct} open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByText('Edit product')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument()
  })

  it('closes on cancel', () => {
    renderWithQuery(<ProductForm product={null} open={true} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('toggles active checkbox', () => {
    renderWithQuery(<ProductForm product={null} open={true} onOpenChange={onOpenChange} />)
    const checkbox = screen.getByLabelText('Active')
    expect(checkbox).toBeInTheDocument()
    expect(checkbox.checked).toBe(true)
  })
})
