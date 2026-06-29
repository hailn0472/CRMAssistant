import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import type { LoginDto } from './dto/login.dto'
import type { RegisterDto } from './dto/register.dto'

function makeAuthService(): Pick<AuthService, 'register' | 'login' | 'logout'> {
  return {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
  }
}

describe('AuthController', () => {
  let controller: AuthController
  let authService: Pick<AuthService, 'register' | 'login' | 'logout'>

  beforeEach(() => {
    authService = makeAuthService()
    controller = new AuthController(authService as AuthService)
  })

  it('should delegate register to AuthService', async () => {
    const dto: RegisterDto = {
      email: 'user@example.com',
      password: 'Password123',
      firstName: 'Test',
      lastName: 'User',
      tenantName: 'ACME Corp',
    }
    const response = {
      accessToken: 'token',
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
    }
    jest.mocked(authService.register).mockResolvedValue(response)

    await expect(controller.register(dto)).resolves.toEqual(response)
    expect(authService.register).toHaveBeenCalledWith(dto)
  })

  it('should delegate login to AuthService', async () => {
    const dto: LoginDto = { email: 'user@example.com', password: 'Password123' }
    const response = {
      accessToken: 'token',
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
    }
    jest.mocked(authService.login).mockResolvedValue(response)

    await expect(controller.login(dto)).resolves.toEqual(response)
    expect(authService.login).toHaveBeenCalledWith(dto)
  })

  it('should extract bearer token and delegate logout to AuthService', async () => {
    jest.mocked(authService.logout).mockResolvedValue(undefined)

    await expect(controller.logout('Bearer token')).resolves.toBeUndefined()
    expect(authService.logout).toHaveBeenCalledWith('token')
  })

  it('should handle missing authorization header', async () => {
    jest.mocked(authService.logout).mockResolvedValue(undefined)

    await expect(controller.logout(undefined as unknown as string)).resolves.toBeUndefined()
    expect(authService.logout).toHaveBeenCalledWith('')
  })
})
