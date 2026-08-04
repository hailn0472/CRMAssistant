import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DealsWorkspace } from '../DealsWorkspace'
import { getDeals, getDealStages } from '@/services/deal.service'
import { getContacts } from '@/services/contact.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/deal.service', () => ({
  getDeals: jest.fn(),
  createDeal: jest.fn(),
  updateDeal: jest.fn(),
  getDealStages: jest.fn(),
}))

jest.mock('@/services/contact.service', () => ({
  getContacts: jest.fn(),
}))

function renderWorkspace(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <DealsWorkspace />
    </QueryClientProvider>,
  )
}

describe('DealsWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDeals as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
    ;(getDealStages as jest.Mock).mockResolvedValue([])
    ;(getContacts as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('opens the create-deal drawer instead of navigating away', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /create deal/i }))

    expect(await screen.findByRole('dialog', { name: 'New deal' })).toBeInTheDocument()
  })

  it('closes the drawer from its close button', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(screen.getByRole('button', { name: /create deal/i }))
    await screen.findByRole('dialog', { name: 'New deal' })

    await user.click(screen.getByRole('button', { name: 'Close panel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
