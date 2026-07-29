export type DefaultDealStageDef = {
  name: string
  order: number
  probability: number
  isWon: boolean
  isLost: boolean
  color: string
}

export const DEFAULT_DEAL_STAGES: DefaultDealStageDef[] = [
  {
    name: 'Lead',
    order: 0,
    probability: 10,
    isWon: false,
    isLost: false,
    color: '#3B82F6',
  },
  {
    name: 'Qualified',
    order: 1,
    probability: 25,
    isWon: false,
    isLost: false,
    color: '#8B5CF6',
  },
  {
    name: 'Proposal',
    order: 2,
    probability: 50,
    isWon: false,
    isLost: false,
    color: '#F59E0B',
  },
  {
    name: 'Negotiation',
    order: 3,
    probability: 75,
    isWon: false,
    isLost: false,
    color: '#EF4444',
  },
  {
    name: 'Closed Won',
    order: 4,
    probability: 100,
    isWon: true,
    isLost: false,
    color: '#10B981',
  },
  {
    name: 'Closed Lost',
    order: 5,
    probability: 0,
    isWon: false,
    isLost: true,
    color: '#6B7280',
  },
]
