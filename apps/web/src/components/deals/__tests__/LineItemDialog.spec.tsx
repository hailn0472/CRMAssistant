// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { LineItemDialog } from '../LineItemDialog'
import { getProducts, addLineItemToDeal } from '@/services/product.service'

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/product.service', () => ({
  getProducts: jest.fn(),
  addLineItemToDeal: jest.fn(),
  getDealLineItems: jest.fn(),
  updateLineItem: jest.fn(),
  removeLineItem: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockProducts = {
  items: [
    {
      id: 'product-1',
      name: 'Consulting',
      price: 5000,
      currency: 'USD',
      isActive: true,
      description: null,
      createdAt: '',
      updatedAt: '',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
}

function renderWithQuery(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('LineItemDialog', () => {
  const onOpenChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    getProducts.mockResolvedValue(mockProducts)
  })

  it('renders dialog when open is true', () => {
    renderWithQuery(
      <LineItemDialog dealId="deal-1" currency="USD" open={true} onOpenChange={onOpenChange} />,
    )
    expect(screen.getByText('Add product')).toBeInTheDocument()
  })

  it('renders nothing when open is false', () => {
    renderWithQuery(
      <LineItemDialog dealId="deal-1" currency="USD" open={false} onOpenChange={onOpenChange} />,
    )
    expect(screen.queryByText('Add product')).not.toBeInTheDocument()
  })

  it('pre-fills unit price from selected product', async () => {
    renderWithQuery(
      <LineItemDialog dealId="deal-1" currency="USD" open={true} onOpenChange={onOpenChange} />,
    )

    const searchInput = screen.getByPlaceholderText('Search products...')
    fireEvent.focus(searchInput)

    await waitFor(() => {
      const productBtn = screen.getByText('Consulting')
      fireEvent.click(productBtn)
    })

    // After selecting product, unit price field should be updated
    const unitPriceInput = screen.getByDisplayValue('5000')
    expect(unitPriceInput).toBeInTheDocument()
  })

  it('shows discount input with correct label', () => {
    renderWithQuery(
      <LineItemDialog dealId="deal-1" currency="USD" open={true} onOpenChange={onOpenChange} />,
    )
    expect(screen.getByText('Discount (%)')).toBeInTheDocument()
  })

  it('shows quantity input', () => {
    renderWithQuery(
      <LineItemDialog dealId="deal-1" currency="USD" open={true} onOpenChange={onOpenChange} />,
    )
    expect(screen.getByText('Quantity')).toBeInTheDocument()
  })

  it('shows live total preview', () => {
    renderWithQuery(
      <LineItemDialog dealId="deal-1" currency="USD" open={true} onOpenChange={onOpenChange} />,
    )
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('calls addLineItemToDeal on submit', async () => {
    addLineItemToDeal.mockResolvedValue({ id: 'li-1' })
    renderWithQuery(
      <LineItemDialog dealId="deal-1" currency="USD" open={true} onOpenChange={onOpenChange} />,
    )

    // Fill in product via search dropdown
    const searchInput = screen.getByPlaceholderText('Search products...')
    fireEvent.focus(searchInput)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
    })

    // Click the product
    const productBtn = screen.getByText('Consulting')
    fireEvent.click(productBtn)

    // Fill in quantity
    const qtyInput = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(qtyInput, { target: { value: '2' } })

    // Submit
    const submitBtn = screen.getByText('Add to deal')
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(addLineItemToDeal).toHaveBeenCalled()
    })
  })

  it('closes on cancel', () => {
    renderWithQuery(
      <LineItemDialog dealId="deal-1" currency="USD" open={true} onOpenChange={onOpenChange} />,
    )

    const cancelBtn = screen.getByText('Cancel')
    fireEvent.click(cancelBtn)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
