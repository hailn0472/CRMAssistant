jest.mock('../sharing-check', () => {
  const actual = jest.requireActual('../sharing-check')
  return actual
})

import { resolveSharedRecordIds, registerSharingCheck } from '../sharing-check'

type MockPrismaService = {
  user: { findUnique: jest.Mock }
  sharingRule: { findMany: jest.Mock }
}

describe('resolveSharedRecordIds', () => {
  let mockPrisma: MockPrismaService
  const USER_ID = 'user-1'
  const TENANT_ID = 'tenant-1'

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = {
      user: { findUnique: jest.fn() },
      sharingRule: { findMany: jest.fn() },
    }
    registerSharingCheck(mockPrisma as never)
  })

  it('returns record IDs shared directly with user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER_ID, teamId: null, tenantId: TENANT_ID })
    mockPrisma.sharingRule.findMany.mockResolvedValue([
      { resourceId: 'contact-1' },
      { resourceId: 'contact-2' },
    ])

    const result = await resolveSharedRecordIds(USER_ID, TENANT_ID, 'CONTACT')
    expect(result).toEqual(['contact-1', 'contact-2'])
    expect(mockPrisma.sharingRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ sharedWithUserId: USER_ID }],
        }),
      }),
    )
  })

  it("returns record IDs shared with user's team", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      teamId: 'team-1',
      tenantId: TENANT_ID,
    })
    mockPrisma.sharingRule.findMany.mockResolvedValue([{ resourceId: 'contact-3' }])

    const result = await resolveSharedRecordIds(USER_ID, TENANT_ID, 'CONTACT')
    expect(result).toEqual(['contact-3'])
    expect(mockPrisma.sharingRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { sharedWithUserId: USER_ID },
            { sharedWithTeamId: 'team-1' },
          ]),
        }),
      }),
    )
  })

  it('returns empty array when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)

    const result = await resolveSharedRecordIds(USER_ID, TENANT_ID, 'CONTACT')
    expect(result).toEqual([])
  })

  it('returns empty array when tenant does not match', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      teamId: null,
      tenantId: 'other-tenant',
    })

    const result = await resolveSharedRecordIds(USER_ID, TENANT_ID, 'CONTACT')
    expect(result).toEqual([])
  })

  it('returns empty array when no sharing rules exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER_ID, teamId: null, tenantId: TENANT_ID })
    mockPrisma.sharingRule.findMany.mockResolvedValue([])

    const result = await resolveSharedRecordIds(USER_ID, TENANT_ID, 'CONTACT')
    expect(result).toEqual([])
  })
})
