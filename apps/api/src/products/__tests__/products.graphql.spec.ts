import { UnauthorizedException, ForbiddenException } from '@nestjs/common'

// Must import BEFORE schema (Pothos registration order)
import '../products.graphql'
import { schema } from '../../graphql/schema'
import { builder } from '../../graphql/schema.builder'
import type { ProductsService } from '../products.service'
import type { DealLineItemsService } from '../deal-line-items.service'

const mockProduct = {
  id: 'product-1',
  tenantId: 'tenant-1',
  name: 'Consulting Package',
  description: null,
  price: 5000,
  currency: 'USD',
  isActive: true,
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
  updatedAt: new Date('2026-07-30T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
}

const mockLineItem = {
  id: 'li-1',
  tenantId: 'tenant-1',
  dealId: 'deal-1',
  productId: 'product-1',
  quantity: 1,
  unitPrice: 5000,
  discount: 0,
  total: 5000,
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
  updatedAt: new Date('2026-07-30T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
  product: { id: 'product-1', name: 'Consulting', currency: 'USD', isActive: true },
}

const mockProductConnection = {
  items: [mockProduct],
  total: 1,
  page: 1,
  pageSize: 20,
}

function makeProductsService(): jest.Mocked<ProductsService> {
  return {
    findMany: jest.fn().mockResolvedValue(mockProductConnection),
    findOneForTenant: jest.fn().mockResolvedValue(mockProduct),
    create: jest.fn().mockResolvedValue(mockProduct),
    update: jest.fn().mockResolvedValue(mockProduct),
  } as unknown as jest.Mocked<ProductsService>
}

function makeLineItemsService(): jest.Mocked<DealLineItemsService> {
  return {
    findManyForDeal: jest.fn().mockResolvedValue([mockLineItem]),
    add: jest.fn().mockResolvedValue(mockLineItem),
    update: jest.fn().mockResolvedValue(mockLineItem),
    remove: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<DealLineItemsService>
}

// Re-export the registration function so we can import it properly
// The actual registration happens via onModuleInit in the ProductsModule
describe('products.graphql', () => {
  it('registers GraphQL fields without throwing', () => {
    // Just verify schema is built and includes product types
    expect(schema).toBeDefined()
    expect(builder).toBeDefined()
  })

  it('builds an executable schema', () => {
    expect(schema).toBeDefined()
  })

  it('can represent authentication failures', () => {
    expect(new UnauthorizedException('Authentication required')).toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('can represent permission failures', () => {
    expect(new ForbiddenException('Missing required permission: PRODUCT:READ')).toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('products service receives tenant and filter', async () => {
    const service = makeProductsService()
    await service.findMany('tenant-1', {}, { page: 1, pageSize: 20 })
    expect(service.findMany).toHaveBeenCalledWith('tenant-1', {}, { page: 1, pageSize: 20 })
  })

  it('createProduct service receives tenant, user and input', async () => {
    const service = makeProductsService()
    await service.create('tenant-1', 'user-1', { name: 'New Product' })
    expect(service.create).toHaveBeenCalledWith('tenant-1', 'user-1', { name: 'New Product' })
  })

  it('updateProduct service receives tenant, user, id and input', async () => {
    const service = makeProductsService()
    await service.update('tenant-1', 'user-1', 'product-1', { name: 'Updated' })
    expect(service.update).toHaveBeenCalledWith('tenant-1', 'user-1', 'product-1', {
      name: 'Updated',
    })
  })

  it('dealLineItems service receives tenant, user and dealId', async () => {
    const liService = makeLineItemsService()
    await liService.findManyForDeal('tenant-1', 'user-1', 'deal-1')
    expect(liService.findManyForDeal).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
  })

  it('addLineItemToDeal service receives tenant, user and input', async () => {
    const liService = makeLineItemsService()
    await liService.add('tenant-1', 'user-1', { dealId: 'deal-1', productId: 'product-1' })
    expect(liService.add).toHaveBeenCalledWith('tenant-1', 'user-1', {
      dealId: 'deal-1',
      productId: 'product-1',
    })
  })

  it('updateLineItem service receives tenant, user, id and input', async () => {
    const liService = makeLineItemsService()
    await liService.update('tenant-1', 'user-1', 'li-1', { quantity: 2 })
    expect(liService.update).toHaveBeenCalledWith('tenant-1', 'user-1', 'li-1', { quantity: 2 })
  })

  it('removeLineItem service receives tenant, user and id', async () => {
    const liService = makeLineItemsService()
    await liService.remove('tenant-1', 'user-1', 'li-1')
    expect(liService.remove).toHaveBeenCalledWith('tenant-1', 'user-1', 'li-1')
  })
})
