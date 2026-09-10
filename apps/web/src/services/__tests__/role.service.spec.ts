import {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  assignRoleToUser,
  removeRoleFromUser,
} from '@/services/role.service'

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

const MOCK_ROLE = {
  id: 'role-1',
  name: 'Admin',
  description: 'Administrator',
  isSystem: true,
  userCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('getRoles', () => {
  it('should return all roles', async () => {
    mockFetchSuccess({ roles: [MOCK_ROLE] })
    const result = await getRoles()
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Admin')
  })

  it('should propagate errors', async () => {
    mockFetchError('Unauthorized')
    await expect(getRoles()).rejects.toThrow('Unauthorized')
  })
})

describe('createRole', () => {
  it('should create and return the new role', async () => {
    mockFetchSuccess({ createRole: MOCK_ROLE })
    const result = await createRole({ name: 'Admin', description: 'Administrator' })
    expect(result.name).toBe('Admin')
  })

  it('should propagate errors', async () => {
    mockFetchError('Duplicate name')
    await expect(createRole({ name: 'Admin' })).rejects.toThrow('Duplicate name')
  })
})

describe('updateRole', () => {
  it('should update and return the role', async () => {
    const updated = { ...MOCK_ROLE, description: 'Updated' }
    mockFetchSuccess({ updateRole: updated })
    const result = await updateRole('role-1', { description: 'Updated' })
    expect(result.description).toBe('Updated')
  })

  it('should propagate errors', async () => {
    mockFetchError('Not found')
    await expect(updateRole('bad-id', { name: 'X' })).rejects.toThrow('Not found')
  })
})

describe('deleteRole', () => {
  it('should return true on success', async () => {
    mockFetchSuccess({ deleteRole: true })
    const result = await deleteRole('role-1')
    expect(result).toBe(true)
  })

  it('should propagate errors', async () => {
    mockFetchError('Cannot delete system role')
    await expect(deleteRole('system-role')).rejects.toThrow('Cannot delete system role')
  })
})

describe('assignRoleToUser', () => {
  it('should return true on success', async () => {
    mockFetchSuccess({ assignRoleToUser: true })
    const result = await assignRoleToUser('role-1', 'user-1')
    expect(result).toBe(true)
  })

  it('should propagate errors', async () => {
    mockFetchError('User not found')
    await expect(assignRoleToUser('role-1', 'bad-user')).rejects.toThrow('User not found')
  })
})

describe('removeRoleFromUser', () => {
  it('should return true on success', async () => {
    mockFetchSuccess({ removeRoleFromUser: true })
    const result = await removeRoleFromUser('role-1', 'user-1')
    expect(result).toBe(true)
  })

  it('should propagate errors', async () => {
    mockFetchError('Assignment not found')
    await expect(removeRoleFromUser('bad-role', 'user-1')).rejects.toThrow('Assignment not found')
  })
})
