import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { ProductsService } from './products.service'
import type { DealLineItemsService } from './deal-line-items.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── Product Type ──────────────────────────────────────────

type ProductGraphqlShape = {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const ProductRef = builder.objectRef<ProductGraphqlShape>('Product')

ProductRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    description: t.string({
      nullable: true,
      resolve: (p) => p.description ?? null,
    }),
    price: t.exposeFloat('price'),
    currency: t.exposeString('currency'),
    isActive: t.exposeBoolean('isActive'),
    createdAt: t.string({ resolve: (p) => p.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (p) => p.updatedAt.toISOString() }),
  }),
})

// ─── DealLineItem Type ─────────────────────────────────────

type DealLineItemProductShape = {
  id: string
  name: string
  currency: string
  isActive: boolean
}

type DealLineItemGraphqlShape = {
  id: string
  dealId: string
  productId: string
  quantity: number
  unitPrice: number
  discount: number
  total: number
  createdAt: Date
  product: DealLineItemProductShape
}

const DealLineItemRef = builder.objectRef<DealLineItemGraphqlShape>('DealLineItem')

DealLineItemRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    dealId: t.exposeID('dealId'),
    productId: t.exposeID('productId'),
    quantity: t.exposeFloat('quantity'),
    unitPrice: t.exposeFloat('unitPrice'),
    discount: t.exposeFloat('discount'),
    total: t.exposeFloat('total'),
    createdAt: t.string({ resolve: (li) => li.createdAt.toISOString() }),
    product: t.field({
      type: ProductRef,
      resolve: (li) => li.product as unknown as ProductGraphqlShape,
    }),
  }),
})

// ─── ProductConnection Type ────────────────────────────────

const ProductConnectionRef = builder
  .objectRef<{
    items: ProductGraphqlShape[]
    total: number
    page: number
    pageSize: number
  }>('ProductConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [ProductRef], resolve: (c) => c.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── Input Types ───────────────────────────────────────────

const CreateProductInputRef = builder.inputType('CreateProductInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    description: t.string(),
    price: t.float(),
    currency: t.string(),
    isActive: t.boolean(),
  }),
})

const UpdateProductInputRef = builder.inputType('UpdateProductInput', {
  fields: (t) => ({
    name: t.string(),
    description: t.string(),
    price: t.float(),
    currency: t.string(),
    isActive: t.boolean(),
  }),
})

const AddLineItemInputRef = builder.inputType('AddLineItemInput', {
  fields: (t) => ({
    dealId: t.string({ required: true }),
    productId: t.string({ required: true }),
    quantity: t.float(),
    unitPrice: t.float(),
    discount: t.float(),
  }),
})

const UpdateLineItemInputRef = builder.inputType('UpdateLineItemInput', {
  fields: (t) => ({
    quantity: t.float(),
    unitPrice: t.float(),
    discount: t.float(),
  }),
})

const ProductFilterInputRef = builder.inputType('ProductFilterInput', {
  fields: (t) => ({
    search: t.string(),
    includeInactive: t.boolean(),
  }),
})

const ProductPaginationInputRef = builder.inputType('ProductPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service Singletons ────────────────────────────────────

let productsService: ProductsService | undefined
let lineItemsService: DealLineItemsService | undefined

function getProductsService(): ProductsService {
  if (!productsService) throw new Error('ProductsService is not initialized')
  return productsService
}

function getLineItemsService(): DealLineItemsService {
  if (!lineItemsService) throw new Error('DealLineItemsService is not initialized')
  return lineItemsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Query Fields ──────────────────────────────────────────

builder.queryFields((t) => ({
  products: t.field({
    type: ProductConnectionRef,
    args: {
      filter: t.arg({ type: ProductFilterInputRef }),
      pagination: t.arg({ type: ProductPaginationInputRef }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'PRODUCT', 'READ')
      const result = await getProductsService().findMany(
        user.tenantId,
        (args.filter ?? {}) as Parameters<ProductsService['findMany']>[1],
        (args.pagination ?? {}) as Parameters<ProductsService['findMany']>[2],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result as unknown as any
    },
  }),

  dealLineItems: t.field({
    type: [DealLineItemRef],
    args: {
      dealId: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      const items = await getLineItemsService().findManyForDeal(
        user.tenantId,
        user.userId,
        args.dealId,
      )
      return items as unknown as DealLineItemGraphqlShape[]
    },
  }),
}))

// ─── Mutation Fields ──────────────────────────────────────

builder.mutationFields((t) => ({
  createProduct: t.field({
    type: ProductRef,
    args: {
      input: t.arg({ type: CreateProductInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'PRODUCT', 'CREATE')
      const result = await getProductsService().create(
        user.tenantId,
        user.userId,
        args.input as Parameters<ProductsService['create']>[2],
      )
      return result as unknown as ProductGraphqlShape
    },
  }),

  updateProduct: t.field({
    type: ProductRef,
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: UpdateProductInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'PRODUCT', 'UPDATE')
      const result = await getProductsService().update(
        user.tenantId,
        user.userId,
        args.id,
        args.input as Parameters<ProductsService['update']>[3],
      )
      return result as unknown as ProductGraphqlShape
    },
  }),

  addLineItemToDeal: t.field({
    type: DealLineItemRef,
    args: {
      input: t.arg({ type: AddLineItemInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      const result = await getLineItemsService().add(
        user.tenantId,
        user.userId,
        args.input as Parameters<DealLineItemsService['add']>[2],
      )
      return result as unknown as DealLineItemGraphqlShape
    },
  }),

  updateLineItem: t.field({
    type: DealLineItemRef,
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: UpdateLineItemInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      const result = await getLineItemsService().update(
        user.tenantId,
        user.userId,
        args.id,
        args.input as Parameters<DealLineItemsService['update']>[3],
      )
      return result as unknown as DealLineItemGraphqlShape
    },
  }),

  removeLineItem: t.field({
    type: 'Boolean',
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getLineItemsService().remove(user.tenantId, user.userId, args.id)
    },
  }),
}))

// ─── Module Registration ──────────────────────────────────

export function registerProductsGraphql(svc: ProductsService, liSvc: DealLineItemsService): void {
  productsService = svc
  lineItemsService = liSvc
}
