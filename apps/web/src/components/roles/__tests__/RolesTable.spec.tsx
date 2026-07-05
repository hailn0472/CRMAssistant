import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RolesTable } from '../RolesTable'
import * as roleService from '@/services/role.service'

jest.mock('@/services/role.service')

const mockGetRoles = roleService.getRoles as jest.MockedFunction<typeof roleService.getRoles>
const mockDeleteRole = roleService.deleteRole as jest.MockedFunction<typeof roleService.deleteRole>

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('RolesTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders loading state', () => {
    mockGetRoles.mockReturnValue(new Promise(() => {}))
    renderWithQuery(<RolesTable />)
    expect(screen.getByRole('table', { hidden: true })).toBeInTheDocument()
  })

  it('renders role list with system and custom roles', async () => {
    mockGetRoles.mockResolvedValue([
      {
        id: '1',
        name: 'ADMIN',
        description: 'Full access',
        isSystem: true,
        userCount: 2,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: '2',
        name: 'Viewer',
        description: 'Read only',
        isSystem: false,
        userCount: 5,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ])

    renderWithQuery(<RolesTable />)

    expect(await screen.findByText('ADMIN')).toBeInTheDocument()
    expect(await screen.findByText('Viewer')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('renders empty state', async () => {
    mockGetRoles.mockResolvedValue([])
    renderWithQuery(<RolesTable />)
    expect(await screen.findByText('No roles yet')).toBeInTheDocument()
  })

  it('renders error state and retry button', async () => {
    mockGetRoles.mockRejectedValue(new Error('Network error'))
    renderWithQuery(<RolesTable />)
    expect(await screen.findByText('Network error')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('deletes a custom role via confirm', async () => {
    window.confirm = jest.fn(() => true)
    mockDeleteRole.mockResolvedValue(true)
    mockGetRoles.mockResolvedValue([
      {
        id: '2',
        name: 'Viewer',
        description: 'Read only',
        isSystem: false,
        userCount: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ])

    renderWithQuery(<RolesTable />)
    expect(await screen.findByText('Viewer')).toBeInTheDocument()

    const deleteBtn = screen.getByText('Delete')
    deleteBtn.click()

    expect(window.confirm).toHaveBeenCalled()
    expect(mockDeleteRole).toHaveBeenCalledWith('2')
  })
})
