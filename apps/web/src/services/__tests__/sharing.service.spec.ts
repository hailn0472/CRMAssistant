import {
  getSharingRules,
  getSharedWithMe,
  shareRecord,
  unshareRecord,
  updateSharingAccess,
  type SharingRule,
} from '@/services/sharing.service'

const MOCK_RULE: SharingRule = {
  id: 'sr-1',
  resourceType: 'CONTACT',
  resourceId: 'c-1',
  sharedWithUserId: 'u-2',
  sharedWithTeamId: null,
  accessLevel: 'EDIT',
  sharedBy: 'u-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const MOCK_RULES = [MOCK_RULE]

function mockFetchSuccess(data: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  })
}

function mockFetchError(message: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: () => Promise.resolve({ errors: [{ message }] }),
  })
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('getSharingRules', () => {
  it('should return sharing rules for a resource', async () => {
    mockFetchSuccess({ sharingRules: MOCK_RULES })
    const result = await getSharingRules('CONTACT', 'c-1')
    expect(result).toHaveLength(1)
    expect(result[0]!.accessLevel).toBe('EDIT')
  })

  it('should propagate errors', async () => {
    mockFetchError('Not found')
    await expect(getSharingRules('CONTACT', 'bad-id')).rejects.toThrow('Not found')
  })
})

describe('getSharedWithMe', () => {
  it('should return items shared with current user', async () => {
    mockFetchSuccess({ sharedWithMe: MOCK_RULES })
    const result = await getSharedWithMe()
    expect(result).toHaveLength(1)
  })

  it('should filter by resource type when provided', async () => {
    mockFetchSuccess({ sharedWithMe: MOCK_RULES })
    await getSharedWithMe('DEAL')
    expect(global.fetch).toHaveBeenCalled()
  })

  it('should propagate errors', async () => {
    mockFetchError('Unauthorized')
    await expect(getSharedWithMe()).rejects.toThrow('Unauthorized')
  })
})

describe('shareRecord', () => {
  it('should share a record with a user', async () => {
    mockFetchSuccess({ shareRecord: MOCK_RULE })
    const result = await shareRecord({
      resourceType: 'CONTACT',
      resourceId: 'c-1',
      sharedWithUserId: 'u-2',
      accessLevel: 'EDIT',
    })
    expect(result.accessLevel).toBe('EDIT')
    expect(result.sharedWithUserId).toBe('u-2')
  })

  it('should propagate errors', async () => {
    mockFetchError('Invalid access level')
    await expect(
      shareRecord({ resourceType: 'CONTACT', resourceId: 'c-1', accessLevel: 'BAD' }),
    ).rejects.toThrow('Invalid access level')
  })
})

describe('unshareRecord', () => {
  it('should return true on success', async () => {
    mockFetchSuccess({ unshareRecord: true })
    const result = await unshareRecord('sr-1')
    expect(result).toBe(true)
  })

  it('should propagate errors', async () => {
    mockFetchError('Not found')
    await expect(unshareRecord('bad-id')).rejects.toThrow('Not found')
  })
})

describe('updateSharingAccess', () => {
  it('should return the updated rule', async () => {
    const updated = { ...MOCK_RULE, accessLevel: 'FULL' as const }
    mockFetchSuccess({ updateSharingAccess: updated })
    const result = await updateSharingAccess('sr-1', 'FULL')
    expect(result.accessLevel).toBe('FULL')
  })

  it('should propagate errors', async () => {
    mockFetchError('Invalid access level')
    await expect(updateSharingAccess('sr-1', 'INVALID')).rejects.toThrow('Invalid access level')
  })
})
