export type WinLossReasonBucket = {
  reason: string
  count: number
  totalValue: number
  percentage: number
}

export type CompetitorOutcome = {
  competitorId: string
  competitorName: string
  wonCount: number
  lostCount: number
  winRate: number
  totalValue: number
}

export type WinLossAnalysis = {
  totalClosed: number
  wonCount: number
  lostCount: number
  winRate: number
  wonValue: number
  lostValue: number
  currency: string
  lossReasons: WinLossReasonBucket[]
  winReasons: WinLossReasonBucket[]
  competitors: CompetitorOutcome[]
}

export type WinLossFilter = {
  startDate: string
  endDate: string
  ownerId?: string
  teamId?: string
}

import { graphqlRequest } from '@/lib/graphql-client'

const WIN_LOSS_BUCKET_FIELDS = `
  reason
  count
  totalValue
  percentage
`

const COMPETITOR_OUTCOME_FIELDS = `
  competitorId
  competitorName
  wonCount
  lostCount
  winRate
  totalValue
`

export async function getWinLossAnalysis(filter: WinLossFilter): Promise<WinLossAnalysis> {
  const data = await graphqlRequest<{ winLossAnalysis: WinLossAnalysis }>(
    `query WinLossAnalysis($startDate: String!, $endDate: String!, $ownerId: String, $teamId: String) {
      winLossAnalysis(startDate: $startDate, endDate: $endDate, ownerId: $ownerId, teamId: $teamId) {
        totalClosed
        wonCount
        lostCount
        winRate
        wonValue
        lostValue
        currency
        winReasons { ${WIN_LOSS_BUCKET_FIELDS} }
        lossReasons { ${WIN_LOSS_BUCKET_FIELDS} }
        competitors { ${COMPETITOR_OUTCOME_FIELDS} }
      }
    }`,
    {
      startDate: filter.startDate,
      endDate: filter.endDate,
      ownerId: filter.ownerId ?? null,
      teamId: filter.teamId ?? null,
    },
  )
  return data.winLossAnalysis
}
