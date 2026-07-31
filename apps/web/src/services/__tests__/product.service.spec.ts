import {
  getProducts,
  createProduct,
  updateProduct,
  getDealLineItems,
  addLineItemToDeal,
  updateLineItem,
  removeLineItem,
} from '../product.service'

const mockFetch = jest.fn()
global.fetch = mockFetch as any

function mockGraphqlResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  })
}

describe('product.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getProducts', () => {
    it('calls GraphQL with correct query and pagination', async () => {
      mockGraphqlResponse({ products: { items: [], total: 0, page: 1, pageSize: 20 } })
      await getProducts(1, 20, { search: 'test' })
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    it('returns typed ProductConnection', async () => {
      const result = {
        items: [
          {
            id: 'p1',
            name: 'Test',
            price: 100,
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
      mockGraphqlResponse({ products: result })
      const data = await getProducts(1, 20)
      expect(data.items).toHaveLength(1)
      expect(data.total).toBe(1)
    })
  })

  describe('createProduct', () => {
    it('calls createProduct mutation', async () => {
      mockGraphqlResponse({
        createProduct: {
          id: 'p1',
          name: 'Test',
          price: 100,
          currency: 'USD',
          isActive: true,
          description: null,
          createdAt: '',
          updatedAt: '',
        },
      })
      const result = await createProduct({ name: 'Test', price: 100 })
      expect(result.name).toBe('Test')
    })
  })

  describe('updateProduct', () => {
    it('calls updateProduct mutation', async () => {
      mockGraphqlResponse({
        updateProduct: {
          id: 'p1',
          name: 'Updated',
          price: 200,
          currency: 'USD',
          isActive: true,
          description: null,
          createdAt: '',
          updatedAt: '',
        },
      })
      const result = await updateProduct('p1', { name: 'Updated' })
      expect(result.name).toBe('Updated')
    })
  })

  describe('getDealLineItems', () => {
    it('calls dealLineItems query', async () => {
      mockGraphqlResponse({ dealLineItems: [] })
      const result = await getDealLineItems('deal-1')
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('addLineItemToDeal', () => {
    it('calls addLineItemToDeal mutation without total field', async () => {
      const mockLi = {
        id: 'li-1',
        dealId: 'deal-1',
        productId: 'p1',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        total: 100,
        createdAt: '',
        product: { id: 'p1', name: 'P', currency: 'USD', isActive: true },
      }
      mockGraphqlResponse({ addLineItemToDeal: mockLi })
      const result = await addLineItemToDeal({ dealId: 'deal-1', productId: 'p1' })
      expect(result.id).toBe('li-1')
    })
  })

  describe('updateLineItem', () => {
    it('calls updateLineItem mutation', async () => {
      mockGraphqlResponse({
        updateLineItem: {
          id: 'li-1',
          dealId: 'deal-1',
          productId: 'p1',
          quantity: 2,
          unitPrice: 100,
          discount: 0,
          total: 200,
          createdAt: '',
          product: { id: 'p1', name: 'P', currency: 'USD', isActive: true },
        },
      })
      const result = await updateLineItem('li-1', { quantity: 2 })
      expect(result.quantity).toBe(2)
    })
  })

  describe('removeLineItem', () => {
    it('calls removeLineItem mutation', async () => {
      mockGraphqlResponse({ removeLineItem: true })
      const result = await removeLineItem('li-1')
      expect(result).toBe(true)
    })
  })
})
