import {
  getMe,
  getUser,
  getUsers,
  createUser,
  updateUser,
  updateProfile,
  deactivateUser,
  reactivateUser,
  deactivateUsers,
  reactivateUsers,
  deleteUser,
  uploadAvatar,
} from '../user.service'

const mockFetch = jest.fn()
global.fetch = mockFetch

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    headers: { get: jest.fn(() => 'application/json') },
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('userService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getMe', () => {
    it('should return current user', async () => {
      const user = { id: 'u-1', email: 'me@example.com', firstName: 'Me', lastName: 'User' }
      mockFetch.mockResolvedValue(jsonResponse({ data: { me: user } }))

      const result = await getMe()

      expect(result).toEqual(user)
    })
  })

  describe('getUser', () => {
    it('should return user by id', async () => {
      const user = { id: 'u-1', email: 'a@example.com', firstName: 'A', lastName: 'B' }
      mockFetch.mockResolvedValue(jsonResponse({ data: { user } }))

      const result = await getUser('u-1')

      expect(result).toEqual(user)
    })
  })

  describe('getUsers', () => {
    it('should return paginated users', async () => {
      const connection = { items: [], total: 0, page: 1, pageSize: 10 }
      mockFetch.mockResolvedValue(jsonResponse({ data: { users: connection } }))

      const result = await getUsers(1, 10)

      expect(result).toEqual(connection)
    })
  })

  describe('createUser', () => {
    it('should create user and return result', async () => {
      const user = { id: 'u-1', email: 'new@example.com', firstName: 'New', lastName: 'User' }
      mockFetch.mockResolvedValue(jsonResponse({ data: { createUser: user } }))

      const result = await createUser({
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
      })

      expect(result).toEqual(user)
    })
  })

  describe('updateUser', () => {
    it('should update user fields', async () => {
      const user = {
        id: 'u-1',
        email: 'updated@example.com',
        firstName: 'Updated',
        lastName: 'Name',
      }
      mockFetch.mockResolvedValue(jsonResponse({ data: { updateUser: user } }))

      const result = await updateUser('u-1', { firstName: 'Updated' })

      expect(result).toEqual(user)
    })
  })

  describe('updateProfile', () => {
    it('should update current user profile', async () => {
      const user = { id: 'u-1', email: 'me@example.com', firstName: 'Me', lastName: 'Updated' }
      mockFetch.mockResolvedValue(jsonResponse({ data: { updateProfile: user } }))

      const result = await updateProfile({ lastName: 'Updated' })

      expect(result).toEqual(user)
    })
  })

  describe('deactivateUser', () => {
    it('should deactivate a single user', async () => {
      const user = { id: 'u-1', isActive: false }
      mockFetch.mockResolvedValue(jsonResponse({ data: { deactivateUser: user } }))

      const result = await deactivateUser('u-1')

      expect(result).toEqual(user)
    })
  })

  describe('reactivateUser', () => {
    it('should reactivate a single user', async () => {
      const user = { id: 'u-1', isActive: true }
      mockFetch.mockResolvedValue(jsonResponse({ data: { reactivateUser: user } }))

      const result = await reactivateUser('u-1')

      expect(result).toEqual(user)
    })
  })

  describe('deactivateUsers', () => {
    it('should deactivate multiple users', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { deactivateUsers: 3 } }))

      const result = await deactivateUsers(['u-1', 'u-2', 'u-3'])

      expect(result).toBe(3)
    })
  })

  describe('reactivateUsers', () => {
    it('should reactivate multiple users', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { reactivateUsers: 2 } }))

      const result = await reactivateUsers(['u-1', 'u-2'])

      expect(result).toBe(2)
    })
  })

  describe('deleteUser', () => {
    it('should soft-delete a user', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { deleteUser: true } }))

      const result = await deleteUser('u-1')

      expect(result).toBe(true)
    })
  })

  describe('graphql error handling', () => {
    it('should throw on HTTP error with GraphQL errors array', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ errors: [{ message: 'Not authorized' }] }, false))

      await expect(getMe()).rejects.toThrow('Not authorized')
    })

    it('should throw when response is not ok without errors array', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null }, false))

      await expect(getMe()).rejects.toThrow('GraphQL request failed')
    })

    it('should throw when response data is missing', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null }))

      await expect(getMe()).rejects.toThrow('GraphQL response missing data')
    })
  })

  describe('uploadAvatar', () => {
    it('should upload file and return URL', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ url: 'https://example.com/avatar.jpg' }))

      const file = new File(['content'], 'avatar.jpg', { type: 'image/jpeg' })
      const url = await uploadAvatar(file)

      expect(url).toBe('https://example.com/avatar.jpg')
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storage/avatar',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('should throw on upload failure', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ message: 'File too large' }, false))

      const file = new File(['content'], 'avatar.jpg', { type: 'image/jpeg' })

      await expect(uploadAvatar(file)).rejects.toThrow('File too large')
    })

    it('should throw generic error when upload fails without JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: jest.fn(() => 'text/plain') },
        json: jest.fn().mockRejectedValue(new Error('invalid json')),
      } as unknown as Response)

      const file = new File(['content'], 'avatar.jpg', { type: 'image/jpeg' })

      await expect(uploadAvatar(file)).rejects.toThrow('Avatar upload failed')
    })
  })
})
