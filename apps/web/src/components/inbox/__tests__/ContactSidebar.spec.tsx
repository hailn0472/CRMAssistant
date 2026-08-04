import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ContactSidebar } from '../ContactSidebar'
import { getDeals } from '@/services/deal.service'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/services/deal.service', () => ({
  getDeals: jest.fn(),
}))

function renderSidebar(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const contact = {
  id: 'contact-1',
  firstName: 'Dana',
  lastName: 'Whitfield',
  email: 'dana@northwind.com',
  phone: '+1 555 000 1111',
  company: 'Northwind',
  jobTitle: 'VP Operations',
  addressCity: 'San Francisco',
  addressCountry: 'USA',
}

describe('ContactSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDeals as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('renders real contact details instead of hardcoded fake data', async () => {
    renderSidebar(<ContactSidebar contact={contact} />)

    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument()
    expect(screen.getByText('VP Operations · Northwind')).toBeInTheDocument()
    expect(screen.getByText('+1 555 000 1111')).toBeInTheDocument()
    expect(screen.getByText('San Francisco, USA')).toBeInTheDocument()
    expect(screen.queryByText(/123-4567/)).not.toBeInTheDocument()
    expect(screen.queryByText('Vietnamese')).not.toBeInTheDocument()
  })

  it('navigates to the contact detail page when Open contact is clicked', async () => {
    const user = userEvent.setup()
    renderSidebar(<ContactSidebar contact={contact} />)

    await user.click(screen.getByRole('button', { name: 'Open contact' }))

    expect(mockPush).toHaveBeenCalledWith('/contacts/contact-1')
  })

  it('calls onNewTask with the contact id when New task is clicked', async () => {
    const user = userEvent.setup()
    const onNewTask = jest.fn()
    renderSidebar(<ContactSidebar contact={contact} onNewTask={onNewTask} />)

    await user.click(screen.getByRole('button', { name: 'New task' }))

    expect(onNewTask).toHaveBeenCalledWith('contact-1')
  })

  it('shows the first open (not won/lost) deal for the contact', async () => {
    ;(getDeals as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'deal-1',
          title: 'Northwind renewal',
          value: 42000,
          currency: 'USD',
          stageId: 'stage-1',
          stage: { id: 'stage-1', name: 'Proposal', color: '#c2860a', isWon: false, isLost: false },
          expectedCloseDate: '2026-08-22T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    renderSidebar(<ContactSidebar contact={contact} />)

    expect(await screen.findByText('Northwind renewal')).toBeInTheDocument()
    expect(screen.getByText('Proposal')).toBeInTheDocument()
    expect(screen.getByText('$42,000')).toBeInTheDocument()
  })

  it('shows a real empty state when the contact has no open deal', async () => {
    renderSidebar(<ContactSidebar contact={contact} />)

    expect(await screen.findByText('No open deal for this contact.')).toBeInTheDocument()
  })

  it('renders nothing but an empty panel when there is no contact', () => {
    const { container } = renderSidebar(<ContactSidebar contact={null} />)
    expect(container.textContent).toBe('')
  })
})
