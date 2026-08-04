// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ProductsManager } from '../ProductsManager'
import { getProducts, createProduct, updateProduct } from '@/services/product.service'

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
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
}))

const mockHasPermission = jest.fn()
let mockPermissionsLoading = false

jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: () => ({
    permissions: [],
    isLoading: mockPermissionsLoading,
    hasPermission: mockHasPermission,
  }),
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
    {
      id: 'product-2',
      name: 'Support',
      price: 99.99,
      currency: 'EUR',
      isActive: false,
      description: null,
      createdAt: '',
      updatedAt: '',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
}

function renderWithQuery(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ProductsManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPermissionsLoading = false
    mockHasPermission.mockImplementation(() => true)
    getProducts.mockResolvedValue(mockProducts)
  })

  it('renders PermissionLimitedState when user lacks PRODUCT:READ', () => {
    mockHasPermission.mockImplementation(() => false)
    renderWithQuery(<ProductsManager />)
    expect(screen.getByText('Access limited')).toBeInTheDocument()
  })

  it('renders TableSkeleton (not Access limited) while permissions are still loading', () => {
    mockPermissionsLoading = true
    mockHasPermission.mockImplementation(() => false)
    renderWithQuery(<ProductsManager />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Access limited')).not.toBeInTheDocument()
  })

  it('renders TableSkeleton while loading', () => {
    getProducts.mockResolvedValue(new Promise(() => {}))
    renderWithQuery(<ProductsManager />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders ErrorState on query failure', async () => {
    getProducts.mockRejectedValue(new Error('Failed'))
    renderWithQuery(<ProductsManager />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load products')).toBeInTheDocument()
    })
  })

  it('renders EmptyState when no products exist', async () => {
    getProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    renderWithQuery(<ProductsManager />)

    await waitFor(() => {
      expect(screen.getByText('No products yet')).toBeInTheDocument()
    })
  })

  it('renders products table with columns', async () => {
    renderWithQuery(<ProductsManager />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
      expect(screen.getByText('Support')).toBeInTheDocument()
    })

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('renders caption for accessibility', async () => {
    renderWithQuery(<ProductsManager />)

    await waitFor(() => {
      const captions = screen.getAllByText('Products')
      const caption = captions.find((el) => el.tagName === 'CAPTION')
      expect(caption).toBeDefined()
    })
  })

  it('shows Add product button when user can create', async () => {
    renderWithQuery(<ProductsManager />)

    await waitFor(() => {
      const addBtns = screen.getAllByText('Add product')
      expect(addBtns.length).toBeGreaterThan(0)
    })
  })

  it('hides Add product button without PRODUCT:CREATE', async () => {
    mockHasPermission.mockImplementation((resource, action) => {
      if (resource === 'PRODUCT' && action === 'READ') return true
      return false
    })
    getProducts.mockResolvedValue(mockProducts)
    renderWithQuery(<ProductsManager />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
    })

    const addBtns = screen.queryAllByText('Add product')
    expect(addBtns.length).toBe(0)
  })

  it('calls updateProduct on toggle active', async () => {
    updateProduct.mockResolvedValue(mockProducts.items[0])
    renderWithQuery(<ProductsManager />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
    })

    const toggleBtns = screen.getAllByLabelText('Deactivate product')
    fireEvent.click(toggleBtns[0])

    await waitFor(() => {
      expect(updateProduct).toHaveBeenCalledWith('product-1', { isActive: false })
    })
  })

  it('shows edit button and opens dialog on click', async () => {
    renderWithQuery(<ProductsManager />)

    await waitFor(() => {
      expect(screen.getByText('Consulting')).toBeInTheDocument()
    })

    const editBtns = screen.getAllByLabelText('Edit product')
    fireEvent.click(editBtns[0])

    await waitFor(() => {
      expect(screen.getByText('Edit product')).toBeInTheDocument()
    })
  })
})
