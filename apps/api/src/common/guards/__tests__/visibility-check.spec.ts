// Enable the module-level variable to be reset
jest.mock('../visibility-check', () => {
  const actual = jest.requireActual('../visibility-check')
  return actual
})

import { resolveVisibilityFilter, registerVisibilityService } from '../visibility-check'

type MockPrismaService = {
  userRole: { findMany: jest.Mock }
  rolePermission: { count: jest.Mock }
  user: { findUnique: jest.Mock; findMany: jest.Mock }
}

describe('resolveVisibilityFilter', () => {
  let mockPrisma: MockPrismaService
  const USER_ID = 'user-1'
  const TENANT_ID = 'tenant-1'

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = {
      userRole: { findMany: jest.fn() },
      rolePermission: { count: jest.fn() },
      user: { findUnique: jest.fn(), findMany: jest.fn() },
    }
    registerVisibilityService(mockPrisma as never)
  })

  it('returns userId for OWN role', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SALES_REP', dataVisibility: 'OWN' } },
    ])
    mockPrisma.rolePermission.count.mockResolvedValue(0)

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toBe(USER_ID)
  })

  it('returns { in: teamMemberIds } for TEAM role when user has teamId', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SALES_MANAGER', dataVisibility: 'TEAM' } },
    ])
    mockPrisma.rolePermission.count.mockResolvedValue(0)
    mockPrisma.user.findUnique.mockResolvedValue({ teamId: 'team-1' })
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }])

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toEqual({ in: ['user-1', 'user-2'] })
  })

  it('returns userId when TEAM role but no teamId assigned', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SALES_MANAGER', dataVisibility: 'TEAM' } },
    ])
    mockPrisma.rolePermission.count.mockResolvedValue(0)
    mockPrisma.user.findUnique.mockResolvedValue({ teamId: null })

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toBe(USER_ID)
  })

  it('returns undefined for ALL role', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'CUSTOM_MANAGER', dataVisibility: 'ALL' } },
    ])
    mockPrisma.rolePermission.count.mockResolvedValue(0)

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toBeUndefined()
  })

  it('returns undefined for ADMIN role (bypass via role name, regardless of dataVisibility)', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'ADMIN', dataVisibility: 'OWN' } },
    ])

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toBeUndefined()
  })

  it('returns undefined for user with DATA:VIEW_ALL permission (even with OWN role)', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SALES_REP', dataVisibility: 'OWN' } },
    ])
    mockPrisma.rolePermission.count.mockResolvedValue(1)

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toBeUndefined()
  })

  it('returns undefined for multi-role: OWN + ALL → most permissive wins', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SALES_REP', dataVisibility: 'OWN' } },
      { role: { name: 'CUSTOM_ALL', dataVisibility: 'ALL' } },
    ])
    mockPrisma.rolePermission.count.mockResolvedValue(0)

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toBeUndefined()
  })

  it('returns team filter for multi-role: OWN + TEAM → TEAM beats OWN', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SALES_REP', dataVisibility: 'OWN' } },
      { role: { name: 'SALES_MANAGER', dataVisibility: 'TEAM' } },
    ])
    mockPrisma.rolePermission.count.mockResolvedValue(0)
    mockPrisma.user.findUnique.mockResolvedValue({ teamId: 'team-1' })
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-3' }])

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toEqual({ in: ['user-1', 'user-3'] })
  })

  it('returns userId when user has no roles', async () => {
    mockPrisma.userRole.findMany.mockResolvedValue([])
    mockPrisma.rolePermission.count.mockResolvedValue(0)

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toBe(USER_ID)
  })

  it('excludes soft-deleted roles from visibility calculation', async () => {
    // Implementation filters role.deletedAt: null — deleted roles are excluded.
    // Only the non-deleted OWN role is considered, so result is OWN (userId).
    mockPrisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SALES_MANAGER', dataVisibility: 'TEAM' } },
    ])
    mockPrisma.rolePermission.count.mockResolvedValue(0)
    mockPrisma.user.findUnique.mockResolvedValue({ teamId: 'team-1' })
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }])

    const result = await resolveVisibilityFilter(USER_ID, TENANT_ID)
    expect(result).toEqual({ in: ['user-1', 'user-2'] })
  })
})
