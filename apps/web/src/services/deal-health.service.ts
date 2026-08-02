import { graphqlRequest } from '@/lib/graphql-client'

export type DealHealthStatus = 'HEALTHY' | 'AT_RISK' | 'STALE'

export type DealHealthSignal =
  | 'NO_ACTIVITY_7D'
  | 'NO_ACTIVITY_14D'
  | 'NO_CLOSE_DATE'
  | 'PAST_CLOSE_DATE'
  | 'CLOSING_SOON'
  | 'PROBABILITY_MISMATCH'

export type DealHealth = {
  status: DealHealthStatus
  score: number
  signals: DealHealthSignal[]
  snoozedUntil?: string | null
}

export type AtRiskDeal = {
  deal: {
    id: string
    title: string
    value: number
    currency: string
    expectedCloseDate?: string | null
    owner?: { id: string; firstName: string; lastName: string; avatar?: string | null } | null
  }
  health: DealHealth
}

export type AtRiskDealConnection = {
  items: AtRiskDeal[]
  total: number
  page: number
  pageSize: number
}

export type DealReminderSnooze = {
  id: string
  dealId: string
  snoozedUntil: string
}

export type ReminderPreference = {
  emailFrequency: string
  notifyNoActivity: boolean
  notifyClosingSoon: boolean
  notifyAtRisk: boolean
}

export type UpdateReminderPreferenceInput = {
  emailFrequency: string
  notifyNoActivity: boolean
  notifyClosingSoon: boolean
  notifyAtRisk: boolean
}

const DEAL_HEALTH_FIELDS = `
  status
  score
  signals
  snoozedUntil
`

export async function getDealHealth(dealId: string): Promise<DealHealth | null> {
  const data = await graphqlRequest<{ dealHealth: DealHealth | null }>(
    `query DealHealth($dealId: ID!) {
      dealHealth(dealId: $dealId) { ${DEAL_HEALTH_FIELDS} }
    }`,
    { dealId },
  )
  return data.dealHealth
}

export async function getAtRiskDeals(pagination?: {
  page?: number
  pageSize?: number
}): Promise<AtRiskDealConnection> {
  const data = await graphqlRequest<{ atRiskDeals: AtRiskDealConnection }>(
    `query AtRiskDeals($pagination: DealHealthPaginationInput) {
      atRiskDeals(pagination: $pagination) {
        total
        page
        pageSize
        items {
          deal { id title value currency expectedCloseDate owner { id firstName lastName avatar } }
          health { ${DEAL_HEALTH_FIELDS} }
        }
      }
    }`,
    { pagination: pagination ?? undefined },
  )
  return data.atRiskDeals
}

export async function getMyReminderPreferences(): Promise<ReminderPreference> {
  const data = await graphqlRequest<{ myReminderPreferences: ReminderPreference }>(
    `query MyReminderPreferences {
      myReminderPreferences { emailFrequency notifyNoActivity notifyClosingSoon notifyAtRisk }
    }`,
    {},
  )
  return data.myReminderPreferences
}

export async function snoozeDealReminder(
  dealId: string,
  days: number,
): Promise<DealReminderSnooze> {
  const data = await graphqlRequest<{ snoozeDealReminder: DealReminderSnooze }>(
    `mutation SnoozeDealReminder($dealId: ID!, $days: Int!) {
      snoozeDealReminder(dealId: $dealId, days: $days) { id dealId snoozedUntil }
    }`,
    { dealId, days },
  )
  return data.snoozeDealReminder
}

export async function unsnoozeDealReminder(dealId: string): Promise<boolean> {
  const data = await graphqlRequest<{ unsnoozeDealReminder: boolean }>(
    `mutation UnsnoozeDealReminder($dealId: ID!) {
      unsnoozeDealReminder(dealId: $dealId)
    }`,
    { dealId },
  )
  return data.unsnoozeDealReminder
}

export async function updateReminderPreferences(
  input: UpdateReminderPreferenceInput,
): Promise<ReminderPreference> {
  const data = await graphqlRequest<{ updateReminderPreferences: ReminderPreference }>(
    `mutation UpdateReminderPreferences($input: UpdateReminderPreferenceInput!) {
      updateReminderPreferences(input: $input) {
        emailFrequency notifyNoActivity notifyClosingSoon notifyAtRisk
      }
    }`,
    { input },
  )
  return data.updateReminderPreferences
}
