import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'

import { ContactsTable } from '../ContactsTable'
import { getContacts } from '@/services/contact.service'

jest.mock('@/services/contact.service', () => ({
  getContacts: jest.fn(),
}))

// Mock ResizeObserver for ResponsiveTableWrapper
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

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

  it('renders scrollable table region', async () => {
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

    await screen.findByText('Ada Lovelace')

    expect(screen.getByRole('region', { name: 'Scrollable table' })).toBeInTheDocument()
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

  it('renders pagination when contacts exceed page size', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `contact-${i + 1}`,
      email: `user${i + 1}@example.com`,
      firstName: `First${i + 1}`,
      lastName: `Last${i + 1}`,
      company: 'Acme',
      jobTitle: 'Engineer',
    }))
    ;(getContacts as jest.Mock).mockResolvedValue({
      total: 25,
      page: 1,
      pageSize: 10,
      items,
    })

    renderWithQueryClient(<ContactsTable />)

    // Wait for pagination to appear: page 1 button is active
    const page1Btn = await screen.findByRole('button', { name: '1' })
    expect(page1Btn).toHaveClass('bg-indigo-600')
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument()
  })

  it('navigates to next page', async () => {
    ;(getContacts as jest.Mock)
      .mockResolvedValueOnce({
        total: 25,
        page: 1,
        pageSize: 10,
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `contact-${i + 1}`,
          email: `user${i + 1}@example.com`,
          firstName: `First${i + 1}`,
          lastName: `Last${i + 1}`,
          company: 'Acme',
          jobTitle: 'Engineer',
        })),
      })
      .mockResolvedValueOnce({
        total: 25,
        page: 2,
        pageSize: 10,
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `contact-${i + 11}`,
          email: `user${i + 11}@example.com`,
          firstName: `First${i + 11}`,
          lastName: `Last${i + 11}`,
          company: 'Acme',
          jobTitle: 'Engineer',
        })),
      })

    renderWithQueryClient(<ContactsTable />)

    // Wait for page 1 button to appear (pagination rendered)
    const page1Btn = await screen.findByRole('button', { name: '1' })
    expect(page1Btn).toHaveClass('bg-indigo-600')

    // Click page 2
    fireEvent.click(screen.getByRole('button', { name: '2' }))

    // Page 2 should now be active
    const page2Btn = await screen.findByRole('button', { name: '2' })
    expect(page2Btn).toHaveClass('bg-indigo-600')
  })
})
