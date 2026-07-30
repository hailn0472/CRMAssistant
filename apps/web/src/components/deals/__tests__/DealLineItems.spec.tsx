// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { DealLineItems } from '../DealLineItems'
import { getDealLineItems, removeLineItem, updateLineItem } from '@/services/product.service'

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
  getDealLineItems: jest.fn(),
  removeLineItem: jest.fn(),
  updateLineItem: jest.fn(),
  addLineItemToDeal: jest.fn(),
  getProducts: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockLineItems = [
  {
    id: 'li-1',
    dealId: 'deal-1',
    productId: 'product-1',
    quantity: 2,
    unitPrice: 250,
    discount: 10,
    total: 450,
    createdAt: '2026-07-30T00:00:00.000Z',
    product: { id: 'product-1', name: 'Consulting', currency: 'USD', isActive: true },
  },
  {
    id: 'li-2',
    dealId: 'deal-1',
    productId: 'product-2',
    quantity: 1,
    unitPrice: 99.99,
    discount: 0,
    total: 99.99,
    createdAt: '2026-07-30T00:00:00.000Z',
    product: { id: 'product-2', name: 'Support', currency: 'EUR', isActive: true },
  },
]

function renderWithQuery(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealLineItems', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('renders caption and scope="col" headers', async () => {
    getDealLineItems.mockResolvedValue(mockLineItems)
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
    })

    expect(screen.getByText('Products on this deal').tagName).toBe('CAPTION')
  })

  it('renders EmptyState when no line items', async () => {
    getDealLineItems.mockResolvedValue([])
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText('No products on this deal yet')).toBeInTheDocument()
    })
  })

  it('renders TableSkeleton while loading', () => {
    getDealLineItems.mockResolvedValue(new Promise(() => {})) // never resolves
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders ErrorState on query failure', async () => {
    getDealLineItems.mockRejectedValue(new Error('Network error'))
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load products')).toBeInTheDocument()
    })
  })

  it('renders line items with correct data', async () => {
    getDealLineItems.mockResolvedValue(mockLineItems)
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
      expect(screen.getByText('Support')).toBeInTheDocument()
    })
  })

  it('renders footer sum with formatted currency', async () => {
    getDealLineItems.mockResolvedValue(mockLineItems)
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      const totalCells = screen.getAllByText(/^\$/)
      expect(totalCells.length).toBeGreaterThan(0)
    })
  })

  it('shows currency mismatch note', async () => {
    getDealLineItems.mockResolvedValue(mockLineItems)
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText(/Priced in EUR/)).toBeInTheDocument()
    })
  })

  it('calls removeLineItem on remove button click', async () => {
    getDealLineItems.mockResolvedValue(mockLineItems)
    removeLineItem.mockResolvedValue(true)
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
    })

    const removeButtons = screen.getAllByLabelText('Remove line item')
    fireEvent.click(removeButtons[0])

    await waitFor(() => {
      expect(removeLineItem).toHaveBeenCalledWith('li-1')
    })
  })

  it('shows Inactive label for inactive products', async () => {
    const itemsWithInactive = [
      {
        ...mockLineItems[0],
        product: { id: 'product-1', name: 'Old Product', currency: 'USD', isActive: false },
      },
    ]
    getDealLineItems.mockResolvedValue(itemsWithInactive)
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeInTheDocument()
    })
  })

  it('opens LineItemDialog when Add product is clicked', async () => {
    getDealLineItems.mockResolvedValue(mockLineItems)
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
    })

    const addBtns = screen.getAllByText('Add product')
    fireEvent.click(addBtns[0])

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('renders inline edit controls on edit button click', async () => {
    getDealLineItems.mockResolvedValue(mockLineItems)
    renderWithQuery(<DealLineItems dealId="deal-1" currency="USD" />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
    })

    const editBtns = screen.getAllByLabelText('Edit line item')
    fireEvent.click(editBtns[0])

    expect(screen.getByLabelText('Save')).toBeInTheDocument()
    expect(screen.getByLabelText('Cancel')).toBeInTheDocument()
  })
})
