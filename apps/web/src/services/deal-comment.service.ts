import { graphqlRequest } from '@/lib/graphql-client'

export type DealCommentUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

export type DealComment = {
  id: string
  dealId: string
  userId: string
  comment: string
  createdAt: string
  author: DealCommentUser
  mentionedUsers: DealCommentUser[]
}

export type DealCommentConnection = {
  items: DealComment[]
  total: number
  page: number
  pageSize: number
}

const DEAL_COMMENT_FIELDS = `
  id
  dealId
  userId
  comment
  createdAt
  author { id firstName lastName email avatar }
  mentionedUsers { id firstName lastName email avatar }
`

export async function getDealComments(
  dealId: string,
  pagination: { page?: number; pageSize?: number } = {},
): Promise<DealCommentConnection> {
  const data = await graphqlRequest<{ dealComments: DealCommentConnection }>(
    `query DealComments($dealId: ID!, $pagination: DealCommentPaginationInput) {
      dealComments(dealId: $dealId, pagination: $pagination) {
        total
        page
        pageSize
        items { ${DEAL_COMMENT_FIELDS} }
      }
    }`,
    {
      dealId,
      pagination: {
        page: pagination.page ?? undefined,
        pageSize: pagination.pageSize ?? undefined,
      },
    },
  )
  return data.dealComments
}

export async function addDealComment(dealId: string, comment: string): Promise<DealComment> {
  const data = await graphqlRequest<{ addDealComment: DealComment }>(
    `mutation AddDealComment($input: AddDealCommentInput!) {
      addDealComment(input: $input) { ${DEAL_COMMENT_FIELDS} }
    }`,
    { input: { dealId, comment } },
  )
  return data.addDealComment
}

export async function deleteDealComment(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteDealComment: boolean }>(
    `mutation DeleteDealComment($id: ID!) {
      deleteDealComment(id: $id)
    }`,
    { id },
  )
  return data.deleteDealComment
}

export async function getDealMentionCandidates(
  dealId: string,
  search?: string,
): Promise<DealCommentUser[]> {
  const data = await graphqlRequest<{ dealMentionCandidates: DealCommentUser[] }>(
    `query DealMentionCandidates($dealId: ID!, $search: String) {
      dealMentionCandidates(dealId: $dealId, search: $search) { id firstName lastName email avatar }
    }`,
    { dealId, search: search ?? undefined },
  )
  return data.dealMentionCandidates
}

export const ON_DEAL_COMMENT_ADDED_SUBSCRIPTION = `
  subscription OnDealCommentAdded($dealId: ID!) {
    onDealCommentAdded(dealId: $dealId) { ${DEAL_COMMENT_FIELDS} }
  }
`
