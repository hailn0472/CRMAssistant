import { graphqlRequest } from '@/lib/graphql-client'

// ─── Types ─────────────────────────────────────────────────

export type Competitor = {
  id: string
  name: string
  website: string | null
  strengths: string | null
  weaknesses: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CompetitorConnection = {
  items: Competitor[]
  total: number
  page: number
  pageSize: number
}

export type CompetitorFormData = {
  name: string
  website?: string | null
  strengths?: string | null
  weaknesses?: string | null
  isActive?: boolean
}

export type DealCompetitor = {
  id: string
  dealId: string
  competitorId: string
  note: string | null
  createdAt: string
  competitor: {
    id: string
    name: string
    website: string | null
    strengths: string | null
    weaknesses: string | null
    isActive: boolean
    createdAt: string
    updatedAt: string
  }
}

export type WinLossReason = 'PRICE' | 'FEATURES' | 'TIMING' | 'COMPETITOR' | 'BUDGET' | 'OTHER'

export type RecordWinLossInput = {
  dealId: string
  stageId?: string
  reason: WinLossReason
  competitorId?: string | null
  note?: string | null
}

// ─── Fragments ────────────────────────────────────────────

const COMPETITOR_FIELDS = `
  id
  name
  website
  strengths
  weaknesses
  isActive
  createdAt
  updatedAt
`

const DEAL_COMPETITOR_FIELDS = `
  id
  dealId
  competitorId
  note
  createdAt
  competitor {
    ${COMPETITOR_FIELDS}
  }
`

// ─── Queries ──────────────────────────────────────────────

export async function getCompetitors(
  page = 1,
  pageSize = 20,
  filter?: { search?: string; includeInactive?: boolean },
): Promise<CompetitorConnection> {
  return graphqlRequest<CompetitorConnection>(
    `
    query Competitors($filter: CompetitorFilterInput, $pagination: CompetitorPaginationInput) {
      competitors(filter: $filter, pagination: $pagination) {
        items {
          ${COMPETITOR_FIELDS}
        }
        total
        page
        pageSize
      }
    }
    `,
    { filter: filter ?? {}, pagination: { page, pageSize } },
  ).then((data) => (data as unknown as { competitors: CompetitorConnection }).competitors)
}

export async function getDealCompetitors(dealId: string): Promise<DealCompetitor[]> {
  return graphqlRequest<DealCompetitor[]>(
    `
    query DealCompetitors($dealId: String!) {
      dealCompetitors(dealId: $dealId) {
        ${DEAL_COMPETITOR_FIELDS}
      }
    }
    `,
    { dealId },
  ).then((data) => (data as unknown as { dealCompetitors: DealCompetitor[] }).dealCompetitors)
}

// ─── Mutations ────────────────────────────────────────────

export async function createCompetitor(input: CompetitorFormData): Promise<Competitor> {
  return graphqlRequest<Competitor>(
    `
    mutation CreateCompetitor($input: CreateCompetitorInput!) {
      createCompetitor(input: $input) {
        ${COMPETITOR_FIELDS}
      }
    }
    `,
    { input },
  ).then((data) => (data as unknown as { createCompetitor: Competitor }).createCompetitor)
}

export async function updateCompetitor(
  id: string,
  input: Partial<CompetitorFormData>,
): Promise<Competitor> {
  return graphqlRequest<Competitor>(
    `
    mutation UpdateCompetitor($id: String!, $input: UpdateCompetitorInput!) {
      updateCompetitor(id: $id, input: $input) {
        ${COMPETITOR_FIELDS}
      }
    }
    `,
    { id, input },
  ).then((data) => (data as unknown as { updateCompetitor: Competitor }).updateCompetitor)
}

export async function deleteCompetitor(id: string): Promise<boolean> {
  return graphqlRequest<boolean>(
    `
    mutation DeleteCompetitor($id: String!) {
      deleteCompetitor(id: $id)
    }
    `,
    { id },
  ).then((data) => (data as unknown as { deleteCompetitor: boolean }).deleteCompetitor)
}

export async function addCompetitorToDeal(input: {
  dealId: string
  competitorId: string
  note?: string | null
}): Promise<DealCompetitor> {
  return graphqlRequest<DealCompetitor>(
    `
    mutation AddCompetitorToDeal($input: AddCompetitorToDealInput!) {
      addCompetitorToDeal(input: $input) {
        ${DEAL_COMPETITOR_FIELDS}
      }
    }
    `,
    { input },
  ).then((data) => (data as unknown as { addCompetitorToDeal: DealCompetitor }).addCompetitorToDeal)
}

export async function removeCompetitorFromDeal(id: string): Promise<boolean> {
  return graphqlRequest<boolean>(
    `
    mutation RemoveCompetitorFromDeal($id: String!) {
      removeCompetitorFromDeal(id: $id)
    }
    `,
    { id },
  ).then(
    (data) => (data as unknown as { removeCompetitorFromDeal: boolean }).removeCompetitorFromDeal,
  )
}

export async function recordWinLoss(input: RecordWinLossInput): Promise<{ id: string }> {
  return graphqlRequest<{ id: string }>(
    `
    mutation RecordWinLoss($input: RecordWinLossInput!) {
      recordWinLoss(input: $input) {
        id
      }
    }
    `,
    { input },
  ).then((data) => (data as unknown as { recordWinLoss: { id: string } }).recordWinLoss)
}
