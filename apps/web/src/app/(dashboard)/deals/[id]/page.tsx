import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import type { Deal } from '@/services/deal.service'
import { DealDetailClient } from '@/components/deals/DealDetailClient'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

type DealPageProps = {
  params: { id: string }
}

type GraphqlDealResponse = {
  data?: { deal: Deal }
  errors?: Array<{ message: string }>
}

async function loadDeal(id: string): Promise<Deal> {
  const token = cookies().get(AUTH_COOKIE)?.value
  const response = await fetch(`${API_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: `query Deal($id: ID!) {
        deal(id: $id) {
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
      }`,
      variables: { id },
    }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as GraphqlDealResponse
  if (response.status === 401 || response.status === 403) {
    redirect('/login')
  }
  if (
    response.status === 404 ||
    payload.errors?.some((error) => error.message.includes('not found'))
  ) {
    notFound()
  }
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message ?? 'Unable to load deal')
  }
  if (!payload.data?.deal) {
    notFound()
  }
  return payload.data.deal
}

export default async function DealDetailPage({
  params,
}: DealPageProps): Promise<React.JSX.Element> {
  const deal = await loadDeal(params.id)

  return <DealDetailClient deal={deal} />
}
