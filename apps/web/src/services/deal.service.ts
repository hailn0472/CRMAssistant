export type DealStage = {
  id: string
  name: string
  order: number
  probability: number
  isWon: boolean
  isLost: boolean
  color: string
}

export type DealFilter = {
  search?: string
  stageId?: string
  contactId?: string
  ownerId?: string
  expectedCloseDateFrom?: string
  expectedCloseDateTo?: string
}

export type DealStageSummary = {
  stageId: string
  count: number
  totalValue: number
}

export type Deal = {
  id: string
  title: string
  value: number
  currency: string
  probability: number
  stageId: string
  contactId: string
  ownerId: string
  expectedCloseDate?: string | null
  actualCloseDate?: string | null
  stage?: DealStage | null
  contact?: {
    id: string
    firstName: string
    lastName: string
    email: string
  } | null
  owner?: {
    id: string
    firstName: string
    lastName: string
    email: string
    avatar?: string | null
  } | null
  winLossReason?: string | null
  winLossNote?: string | null
  competitorId?: string | null
  competitor?: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export type DealConnection = {
  items: Deal[]
  total: number
  page: number
  pageSize: number
}

export type DealFormData = {
  title: string
  value?: number
  currency?: string
  stageId: string
  contactId: string
  ownerId?: string
  probability?: number
  expectedCloseDate?: string
}

import { graphqlRequest } from '@/lib/graphql-client'

const DEAL_FIELDS = `
  id
  title
  value
  currency
  probability
  stageId
  contactId
  ownerId
  expectedCloseDate
  actualCloseDate
  stage { id name color probability isWon isLost }
  contact { id firstName lastName email }
  owner { id firstName lastName email avatar }
  winLossReason
  winLossNote
  competitorId
  competitor { id name }
  createdAt
  updatedAt
`

export async function getDeals(
  page: number,
  pageSize: number,
  filter?: DealFilter,
): Promise<DealConnection> {
  const hasFilter = Boolean(
    filter?.search ||
      filter?.stageId ||
      filter?.contactId ||
      filter?.ownerId ||
      filter?.expectedCloseDateFrom ||
      filter?.expectedCloseDateTo,
  )
  const data = await graphqlRequest<{ deals: DealConnection }>(
    `query Deals($filter: DealFilterInput, $pagination: DealPaginationInput) {
      deals(filter: $filter, pagination: $pagination) {
        total
        page
        pageSize
        items { ${DEAL_FIELDS} }
      }
    }`,
    {
      filter: hasFilter ? filter : undefined,
      pagination: { page, pageSize },
    },
  )
  return data.deals
}

export async function getDeal(id: string): Promise<Deal> {
  const data = await graphqlRequest<{ deal: Deal }>(
    `query Deal($id: ID!) {
      deal(id: $id) { ${DEAL_FIELDS} }
    }`,
    { id },
  )
  return data.deal
}

export async function getDealStages(): Promise<DealStage[]> {
  const data = await graphqlRequest<{ dealStages: DealStage[] }>(
    `query DealStages {
      dealStages { id name order probability isWon isLost color }
    }`,
    {},
  )
  return data.dealStages
}

export async function createDeal(input: DealFormData): Promise<Deal> {
  const data = await graphqlRequest<{ createDeal: Deal }>(
    `mutation CreateDeal($input: CreateDealInput!) {
      createDeal(input: $input) { ${DEAL_FIELDS} }
    }`,
    { input },
  )
  return data.createDeal
}

export async function updateDeal(id: string, input: Partial<DealFormData>): Promise<Deal> {
  const data = await graphqlRequest<{ updateDeal: Deal }>(
    `mutation UpdateDeal($id: ID!, $input: UpdateDealInput!) {
      updateDeal(id: $id, input: $input) { ${DEAL_FIELDS} }
    }`,
    { id, input },
  )
  return data.updateDeal
}

export async function deleteDeal(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteDeal: boolean }>(
    `mutation DeleteDeal($id: ID!) {
      deleteDeal(id: $id)
    }`,
    { id },
  )
  return data.deleteDeal
}

export async function moveDealToStage(dealId: string, stageId: string): Promise<Deal> {
  const data = await graphqlRequest<{ moveDealToStage: Deal }>(
    `mutation MoveDealToStage($dealId: ID!, $stageId: ID!) {
      moveDealToStage(dealId: $dealId, stageId: $stageId) { ${DEAL_FIELDS} }
    }`,
    { dealId, stageId },
  )
  return data.moveDealToStage
}

export async function createDealStage(
  name: string,
  color?: string,
  probability?: number,
): Promise<DealStage> {
  const data = await graphqlRequest<{ createDealStage: DealStage }>(
    `mutation CreateDealStage($name: String!, $color: String, $probability: Int) {
      createDealStage(name: $name, color: $color, probability: $probability) {
        id name order probability isWon isLost color
      }
    }`,
    { name, color, probability },
  )
  return data.createDealStage
}

export async function updateDealStage(
  id: string,
  input: { name?: string; color?: string; probability?: number },
): Promise<DealStage> {
  const data = await graphqlRequest<{ updateDealStage: DealStage }>(
    `mutation UpdateDealStage($id: ID!, $name: String, $color: String, $probability: Int) {
      updateDealStage(id: $id, name: $name, color: $color, probability: $probability) {
        id name order probability isWon isLost color
      }
    }`,
    { id, ...input },
  )
  return data.updateDealStage
}

export async function deleteDealStage(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteDealStage: boolean }>(
    `mutation DeleteDealStage($id: ID!) {
      deleteDealStage(id: $id)
    }`,
    { id },
  )
  return data.deleteDealStage
}

export async function reorderDealStages(stageIds: string[]): Promise<DealStage[]> {
  const data = await graphqlRequest<{ reorderDealStages: DealStage[] }>(
    `mutation ReorderDealStages($stageIds: [ID!]!) {
      reorderDealStages(stageIds: $stageIds) {
        id name order probability isWon isLost color
      }
    }`,
    { stageIds },
  )
  return data.reorderDealStages
}

export async function getDealPipelineSummary(filter?: DealFilter): Promise<DealStageSummary[]> {
  const hasFilter = Boolean(
    filter?.search ||
      filter?.stageId ||
      filter?.contactId ||
      filter?.ownerId ||
      filter?.expectedCloseDateFrom ||
      filter?.expectedCloseDateTo,
  )
  const data = await graphqlRequest<{ dealPipelineSummary: DealStageSummary[] }>(
    `query DealPipelineSummary($filter: DealFilterInput) {
      dealPipelineSummary(filter: $filter) {
        stageId
        count
        totalValue
      }
    }`,
    { filter: hasFilter ? filter : undefined },
  )
  return data.dealPipelineSummary
}

export const ON_DEAL_UPDATED_SUBSCRIPTION = `subscription OnDealUpdated {
  onDealUpdated {
    id
    title
    value
    currency
    probability
    stageId
    contactId
    ownerId
    expectedCloseDate
    actualCloseDate
    stage { id name color probability isWon isLost }
    contact { id firstName lastName email }
    owner { id firstName lastName email avatar }
    winLossReason
    winLossNote
    competitorId
    competitor { id name }
    createdAt
    updatedAt
  }
}`
