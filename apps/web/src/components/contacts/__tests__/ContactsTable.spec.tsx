import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'

import { ContactsTable } from '../ContactsTable'
import { getContacts } from '@/services/contact.service'

jest.mock('@/services/contact.service', () => ({
  getContacts: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ContactsTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders empty state when no contacts exist', async () => {
    ;(getContacts as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })

    renderWithQueryClient(<ContactsTable />)

    expect(await screen.findByText('No contacts yet')).toBeInTheDocument()
  })

  it('renders contacts in a table', async () => {
    ;(getContacts as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'contact-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          company: 'Analytical Engines',
          jobTitle: 'Founder',
        },
      ],
    })

    renderWithQueryClient(<ContactsTable />)

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('Analytical Engines')).toBeInTheDocument()
  })

  it('renders error state with retry button when loading fails', async () => {
    ;(getContacts as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderWithQueryClient(<ContactsTable />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('clicking retry button refetches contacts', async () => {
    ;(getContacts as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderWithQueryClient(<ContactsTable />)

    const retryButton = await screen.findByRole('button', { name: /try again/i })

    // Change mock to resolve before clicking retry
    ;(getContacts as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'contact-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          company: 'Analytical Engines',
          jobTitle: 'Founder',
        },
      ],
    })

    fireEvent.click(retryButton)

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
  })
})
