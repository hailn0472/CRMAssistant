import {
  getAllPermissions,
  getRolePermissions,
  getMyPermissions,
  assignPermissionToRole,
  removePermissionFromRole,
  setRolePermissions,
} from '../permission.service'

const originalFetch = global.fetch

function mockFetch(responseData: unknown, ok = true, errors?: Array<{ message: string }>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve({ data: responseData, errors }),
  })
}

describe('permission.service', () => {
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  describe('getAllPermissions', () => {
    it('fetches all permissions', async () => {
      const perms = [{ id: '1', resource: 'CONTACT', action: 'READ', description: 'Read contacts' }]
      mockFetch({ allPermissions: perms })

      const result = await getAllPermissions()

      expect(result).toEqual(perms)
    })
  })

  describe('getRolePermissions', () => {
    it('fetches permissions for a role', async () => {
      const perms = [{ id: '1', resource: 'CONTACT', action: 'READ', description: 'Read contacts' }]
      mockFetch({ rolePermissions: perms })

      const result = await getRolePermissions('role-1')

      expect(result).toEqual(perms)
    })
  })

  describe('getMyPermissions', () => {
    it('fetches current user permissions', async () => {
      const checks = [
        { resource: 'CONTACT', action: 'READ', granted: true },
        { resource: 'CONTACT', action: 'DELETE', granted: false },
      ]
      mockFetch({ myPermissions: checks })

      const result = await getMyPermissions()

      expect(result).toEqual(checks)
    })
  })

  describe('assignPermissionToRole', () => {
    it('assigns a permission to a role', async () => {
      const perm = { id: '1', resource: 'CONTACT', action: 'READ', description: null }
      mockFetch({ assignPermissionToRole: perm })

      const result = await assignPermissionToRole('role-1', 'perm-1')

      expect(result).toEqual(perm)
    })
  })

  describe('removePermissionFromRole', () => {
    it('removes a permission from a role', async () => {
      mockFetch({ removePermissionFromRole: true })

      const result = await removePermissionFromRole('role-1', 'perm-1')

      expect(result).toBe(true)
    })
  })

  describe('setRolePermissions', () => {
    it('bulk sets permissions for a role', async () => {
      const perms = [
        { id: '1', resource: 'CONTACT', action: 'READ', description: null },
        { id: '2', resource: 'CONTACT', action: 'UPDATE', description: null },
      ]
      mockFetch({ setRolePermissions: perms })

      const result = await setRolePermissions('role-1', ['1', '2'])

      expect(result).toEqual(perms)
    })
  })

  describe('error handling', () => {
    it('throws on GraphQL errors', async () => {
      mockFetch(null, false, [{ message: 'Permission denied' }])

      await expect(getAllPermissions()).rejects.toThrow('Permission denied')
    })
  })
})
