// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { CompetitorsManager } from '../CompetitorsManager'
import { getCompetitors, updateCompetitor, deleteCompetitor } from '@/services/competitor.service'

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/competitor.service', () => ({
  getCompetitors: jest.fn(),
  createCompetitor: jest.fn(),
  updateCompetitor: jest.fn(),
  deleteCompetitor: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockHasPermission = jest.fn()
let mockPermissionsLoading = false

jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: () => ({
    permissions: [],
    isLoading: mockPermissionsLoading,
    hasPermission: mockHasPermission,
  }),
}))

const mockCompetitors = {
  items: [
    {
      id: 'c1',
      name: 'Acme Corp',
      website: 'https://acme.test',
      strengths: 'Brand',
      weaknesses: 'Price',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'c2',
      name: 'Globex',
      website: null,
      strengths: null,
      weaknesses: null,
      isActive: false,
      createdAt: '',
      updatedAt: '',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
}

function renderWithQuery(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CompetitorsManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPermissionsLoading = false
    mockHasPermission.mockImplementation(() => true)
    getCompetitors.mockResolvedValue(mockCompetitors)
  })

  it('renders PermissionLimitedState when user lacks COMPETITOR:READ (AC #29)', () => {
    mockHasPermission.mockImplementation(() => false)
    renderWithQuery(<CompetitorsManager />)
    expect(screen.getByText('Access limited')).toBeInTheDocument()
  })

  it('renders TableSkeleton (not Access limited) while permissions are still loading', () => {
    mockPermissionsLoading = true
    mockHasPermission.mockImplementation(() => false)
    renderWithQuery(<CompetitorsManager />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Access limited')).not.toBeInTheDocument()
  })

  it('renders the competitor list with name, website, strengths, weaknesses and status (AC #29)', async () => {
    renderWithQuery(<CompetitorsManager />)

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('https://acme.test')).toBeInTheDocument()
    expect(screen.getByText('Brand')).toBeInTheDocument()
    expect(screen.getByText('Price')).toBeInTheDocument()
    expect(screen.getByText('Globex')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('shows the Add competitor button only with COMPETITOR:CREATE (AC #29)', async () => {
    mockHasPermission.mockImplementation((resource, action) => action !== 'CREATE')
    renderWithQuery(<CompetitorsManager />)

    await screen.findByText('Acme Corp')
    expect(screen.queryByText('Add competitor')).not.toBeInTheDocument()
  })

  it('opens the CompetitorForm for editing (AC #29)', async () => {
    renderWithQuery(<CompetitorsManager />)

    const editButtons = await screen.findAllByRole('button', { name: 'Edit competitor' })
    expect(editButtons[0].className).toContain('h-11 w-11')
    fireEvent.click(editButtons[0])

    expect(await screen.findByText('Edit competitor')).toBeInTheDocument()
  })

  it('deletes a competitor after confirmation (AC #29)', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    deleteCompetitor.mockResolvedValue(true)
    renderWithQuery(<CompetitorsManager />)

    const deleteButtons = await screen.findAllByRole('button', { name: 'Delete competitor' })
    fireEvent.click(deleteButtons[0])

    await waitFor(() => {
      expect(deleteCompetitor).toHaveBeenCalledWith('c1')
    })
    expect(toast.success).toHaveBeenCalledWith('Competitor deleted')
  })

  it('toggles active status (AC #29)', async () => {
    updateCompetitor.mockResolvedValue(mockCompetitors.items[0])
    renderWithQuery(<CompetitorsManager />)

    const toggleButtons = await screen.findAllByRole('button', {
      name: 'Deactivate competitor',
    })
    fireEvent.click(toggleButtons[0])

    await waitFor(() => {
      expect(updateCompetitor).toHaveBeenCalledWith('c1', { isActive: false })
    })
  })
})
