import { graphqlRequest } from '@/lib/graphql-client'

// ─── Types ─────────────────────────────────────────────────

export type Product = {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ProductConnection = {
  items: Product[]
  total: number
  page: number
  pageSize: number
}

export type ProductFormData = {
  name: string
  description?: string | null
  price?: number
  currency?: string
  isActive?: boolean
}

export type DealLineItem = {
  id: string
  dealId: string
  productId: string
  quantity: number
  unitPrice: number
  discount: number
  total: number
  createdAt: string
  product: {
    id: string
    name: string
    currency: string
    isActive: boolean
  }
}

export type LineItemFormData = {
  dealId: string
  productId: string
  quantity?: number
  unitPrice?: number
  discount?: number
}

// ─── Fragments ────────────────────────────────────────────

const PRODUCT_FIELDS = `
  id
  name
  description
  price
  currency
  isActive
  createdAt
  updatedAt
`

const LINE_ITEM_FIELDS = `
  id
  dealId
  productId
  quantity
  unitPrice
  discount
  total
  createdAt
  product {
    id
    name
    currency
    isActive
  }
`

// ─── Queries ──────────────────────────────────────────────

export async function getProducts(
  page = 1,
  pageSize = 20,
  filter?: { search?: string; includeInactive?: boolean },
): Promise<ProductConnection> {
  return graphqlRequest<ProductConnection>(
    `
    query Products($filter: ProductFilterInput, $pagination: ProductPaginationInput) {
      products(filter: $filter, pagination: $pagination) {
        items {
          ${PRODUCT_FIELDS}
        }
        total
        page
        pageSize
      }
    }
    `,
    { filter: filter ?? {}, pagination: { page, pageSize } },
  ).then((data) => (data as unknown as { products: ProductConnection }).products)
}

export async function createProduct(input: ProductFormData): Promise<Product> {
  return graphqlRequest<Product>(
    `
    mutation CreateProduct($input: CreateProductInput!) {
      createProduct(input: $input) {
        ${PRODUCT_FIELDS}
      }
    }
    `,
    { input },
  ).then((data) => (data as unknown as { createProduct: Product }).createProduct)
}

export async function updateProduct(id: string, input: Partial<ProductFormData>): Promise<Product> {
  return graphqlRequest<Product>(
    `
    mutation UpdateProduct($id: ID!, $input: UpdateProductInput!) {
      updateProduct(id: $id, input: $input) {
        ${PRODUCT_FIELDS}
      }
    }
    `,
    { id, input },
  ).then((data) => (data as unknown as { updateProduct: Product }).updateProduct)
}

export async function getDealLineItems(dealId: string): Promise<DealLineItem[]> {
  return graphqlRequest<DealLineItem[]>(
    `
    query DealLineItems($dealId: String!) {
      dealLineItems(dealId: $dealId) {
        ${LINE_ITEM_FIELDS}
      }
    }
    `,
    { dealId },
  ).then((data) => (data as unknown as { dealLineItems: DealLineItem[] }).dealLineItems)
}

export async function addLineItemToDeal(input: LineItemFormData): Promise<DealLineItem> {
  return graphqlRequest<DealLineItem>(
    `
    mutation AddLineItemToDeal($input: AddLineItemInput!) {
      addLineItemToDeal(input: $input) {
        ${LINE_ITEM_FIELDS}
      }
    }
    `,
    { input },
  ).then((data) => (data as unknown as { addLineItemToDeal: DealLineItem }).addLineItemToDeal)
}

export async function updateLineItem(
  id: string,
  input: { quantity?: number; unitPrice?: number; discount?: number },
): Promise<DealLineItem> {
  return graphqlRequest<DealLineItem>(
    `
    mutation UpdateLineItem($id: String!, $input: UpdateLineItemInput!) {
      updateLineItem(id: $id, input: $input) {
        ${LINE_ITEM_FIELDS}
      }
    }
    `,
    { id, input },
  ).then((data) => (data as unknown as { updateLineItem: DealLineItem }).updateLineItem)
}

export async function removeLineItem(id: string): Promise<boolean> {
  return graphqlRequest<boolean>(
    `
    mutation RemoveLineItem($id: String!) {
      removeLineItem(id: $id)
    }
    `,
    { id },
  ).then((data) => (data as unknown as { removeLineItem: boolean }).removeLineItem)
}
