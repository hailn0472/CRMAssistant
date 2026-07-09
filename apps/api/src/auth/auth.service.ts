import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import WebSocket from 'ws'
import type { WebSocketLikeConstructor } from '@supabase/realtime-js'

import { PrismaService } from '../prisma/prisma.service'
import { TokenRevocationService } from './token-revocation.service'
import { DEFAULT_ROLE_PERMISSIONS } from '../permissions/default-role-permissions'
import { TwoFactorService } from './two-factor.service'
import type { LoginDto } from './dto/login.dto'
import type { OAuthTokenDto } from './dto/oauth-token.dto'
import type { RegisterDto } from './dto/register.dto'
import type { JwtPayload } from './strategies/jwt.strategy'

export type AuthTokenResponse = {
  accessToken: string
  userId: string
  tenantId: string
  roles: string[]
  email: string
  firstName: string
  lastName: string
  avatar?: string | null
}

export type TwoFactorRequiredResponse = {
  requires2FA: true
  tempToken: string
}

export type TwoFactorSetupRequiredResponse = {
  requires2FASetup: true
  tempToken: string
}

export type LoginResult = AuthTokenResponse | TwoFactorRequiredResponse | TwoFactorSetupRequiredResponse

const SUPABASE_AUTH_TIMEOUT_MS = 10_000

@Injectable()
export class AuthService {
  private readonly supabase: SupabaseClient
  readonly supabaseAdmin?: SupabaseClient

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly twoFactorService: TwoFactorService,
  ) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL') ?? ''
    const supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') ?? ''
    const supabaseServiceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')
    const webSocketTransport = WebSocket as unknown as WebSocketLikeConstructor

    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        transport: webSocketTransport,
      },
    })

    if (supabaseServiceRoleKey) {
      this.supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        realtime: {
          transport: webSocketTransport,
        },
      })
    }
  }

  async register(dto: RegisterDto): Promise<AuthTokenResponse> {
    const tenantName = dto.tenantName.trim()
    if (!tenantName) {
      throw new BadRequestException('tenantName is required for registration')
    }

    // 1. Create Supabase Auth user
    const { data: supabaseData, error: supabaseError } = await this.withSupabaseAuthTimeout(
      this.supabase.auth.signUp({
        email: dto.email,
        password: dto.password,
      }),
      'Registration timed out while contacting Supabase Auth',
    )

    if (supabaseError || !supabaseData.user) {
      if (supabaseError?.message?.toLowerCase().includes('already registered')) {
        throw new ConflictException('Email already registered')
      }
      throw new BadRequestException(supabaseError?.message ?? 'Registration failed')
    }

    // 2. Create Tenant + System Roles + User + assign SALES_REP role in a transaction
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: tenantName },
        })

        // Seed system roles for the new tenant (migration only seeds existing tenants)
        const systemRoles = [
          { name: 'ADMIN', description: 'Full system access', dataVisibility: 'ALL' as const },
          {
            name: 'SALES_MANAGER',
            description: 'Sales team manager',
            dataVisibility: 'TEAM' as const,
          },
          {
            name: 'SALES_REP',
            description: 'Sales representative',
            dataVisibility: 'OWN' as const,
          },
          {
            name: 'SUPPORT_AGENT',
            description: 'Customer support agent',
            dataVisibility: 'OWN' as const,
          },
          {
            name: 'MARKETING_USER',
            description: 'Marketing team member',
            dataVisibility: 'OWN' as const,
          },
        ]

        let salesRepRole: { id: string; name: string } | null = null
        const createdRoles: { id: string; name: string }[] = []

        for (const roleDef of systemRoles) {
          const role = await tx.role.create({
            data: {
              tenantId: tenant.id,
              name: roleDef.name,
              description: roleDef.description,
              isSystem: true,
              dataVisibility: roleDef.dataVisibility,
              createdBy: 'system',
              updatedBy: 'system',
            },
          })
          createdRoles.push({ id: role.id, name: role.name })
          if (roleDef.name === 'SALES_REP') {
            salesRepRole = role
          }
        }

        // Assign default permissions to system roles
        await this.assignDefaultPermissionsForRoles(tx, createdRoles)

        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.email,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            supabaseUserId: supabaseData.user!.id,
            isActive: true,
            createdBy: 'system',
            updatedBy: 'system',
          },
        })

        if (salesRepRole) {
          await tx.userRole.create({
            data: {
              userId: user.id,
              roleId: salesRepRole.id,
              assignedBy: 'system',
            },
          })
        }

        const roles = salesRepRole ? ['SALES_REP'] : []

        return { user, roles }
      })

      const accessToken = await this.signAuthToken({
        userId: result.user.id,
        tenantId: result.user.tenantId,
        email: result.user.email,
        roles: result.roles,
      })

      return {
        accessToken,
        userId: result.user.id,
        tenantId: result.user.tenantId,
        roles: result.roles,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        avatar: result.user.avatar,
      }
    } catch (error) {
      await this.cleanupSupabaseUser(supabaseData.user.id)

      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already exists in this tenant')
      }
      throw new InternalServerErrorException('Registration failed — please try again')
    }
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const { data: supabaseData, error: supabaseError } = await this.withSupabaseAuthTimeout(
      this.supabase.auth.signInWithPassword({
        email: dto.email,
        password: dto.password,
      }),
      'Login timed out while contacting Supabase Auth',
    )

    if (supabaseError || !supabaseData.user) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const user = await this.prisma.user.findFirst({
      where: {
        supabaseUserId: supabaseData.user.id,
        deletedAt: null,
        isActive: true,
      },
      include: {
        tenant: { select: { enforce2FA: true } },
      },
    })

    if (!user) {
      const usersByEmail = await this.prisma.user.findMany({
        where: {
          email: dto.email,
          deletedAt: null,
          isActive: true,
        },
        include: {
          tenant: { select: { enforce2FA: true } },
        },
      })

      if (usersByEmail.length !== 1) {
        // Check if user exists but is deactivated
        const deactivatedUser = await this.prisma.user.findFirst({
          where: {
            email: dto.email,
            deletedAt: null,
            isActive: false,
          },
        })
        if (deactivatedUser) {
          throw new UnauthorizedException('Account has been deactivated')
        }
        throw new UnauthorizedException('User account not found or ambiguous')
      }

      const userByEmail = usersByEmail[0]
      const linkedUser = await this.prisma.user.update({
        where: { id: userByEmail.id },
        data: {
          supabaseUserId: supabaseData.user.id,
          lastLoginAt: new Date(),
          updatedBy: 'system',
        },
      })

      // Check 2FA after linking
      if (linkedUser.twoFactorEnabled) {
        return this.respondTwoFactorRequired(linkedUser.id, linkedUser.tenantId)
      }

      // Check enforce2FA — query tenant separately since update doesn't include relations
      const linkedTenant = await this.prisma.tenant.findFirst({
        where: { id: linkedUser.tenantId },
        select: { enforce2FA: true },
      })
      if (linkedTenant?.enforce2FA && !linkedUser.twoFactorEnabled) {
        return this.respondTwoFactorSetupRequired(linkedUser.id, linkedUser.tenantId)
      }

      const roles = await this.resolveUserRoles(linkedUser.id)
      return this.buildAuthTokenResponse(linkedUser, roles)
    }

    // Check 2FA
    if (user.twoFactorEnabled) {
      return this.respondTwoFactorRequired(user.id, user.tenantId)
    }

    // Check enforce2FA from included tenant relation
    if ('tenant' in user && user.tenant?.enforce2FA && !user.twoFactorEnabled) {
      return this.respondTwoFactorSetupRequired(user.id, user.tenantId)
    }

    // Set lastLoginAt
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const roles = await this.resolveUserRoles(user.id)
    return this.buildAuthTokenResponse(user, roles)
  }

  async oauthLogin(dto: OAuthTokenDto): Promise<AuthTokenResponse> {
    // Phase 1: Verify Supabase token
    const { data: supabaseData, error: supabaseError } = await this.withSupabaseAuthTimeout(
      this.supabase.auth.getUser(dto.accessToken),
      'Xác thực Google quá thời gian — vui lòng thử lại',
    )

    if (supabaseError || !supabaseData.user) {
      throw new UnauthorizedException('Xác thực Google không thành công — vui lòng thử lại')
    }

    const supabaseUser = supabaseData.user
    const email = supabaseUser.email
    if (!email) {
      throw new UnauthorizedException('Không thể lấy email từ tài khoản Google')
    }

    // Detect SSO provider from Supabase user metadata
    const provider = supabaseUser.app_metadata?.provider as string | undefined
    const ssoProviderName = provider === 'google' ? 'GOOGLE' : provider === 'azure' ? 'AZURE_AD' : undefined
    const ssoId = supabaseUser.id

    // Phase 2: Lookup existing user by supabaseUserId
    let user = await this.prisma.user.findFirst({
      where: {
        supabaseUserId: supabaseUser.id,
        deletedAt: null,
        isActive: true,
      },
    })

    if (user) {
      // Check 2FA enforcement
      const ssoUser = await this.prisma.user.findFirst({
        where: { id: user.id },
        include: { tenant: { select: { enforce2FA: true } } },
      })
      if (ssoUser?.tenant?.enforce2FA && !ssoUser.twoFactorEnabled) {
        throw new UnauthorizedException(
          'Quản trị viên yêu cầu xác thực hai yếu tố. Vui lòng đăng nhập bằng email và thiết lập 2FA trước.',
        )
      }

      const avatar = (supabaseUser.user_metadata?.['avatar_url'] as string) ?? null
      const ssoUpdate: Record<string, unknown> = {
        lastLoginAt: new Date(),
        avatar,
        updatedBy: 'system',
      }
      if (ssoProviderName && ssoId && (!user.ssoProvider || !user.ssoId)) {
        ssoUpdate.ssoProvider = ssoProviderName
        ssoUpdate.ssoId = ssoId
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: ssoUpdate,
      })

      const roles = await this.resolveUserRoles(user.id)
      const accessToken = await this.signAuthToken({
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        roles,
      })

      return {
        accessToken,
        userId: user.id,
        tenantId: user.tenantId,
        roles,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
      }
    }

    // Not found by supabaseUserId — email fallback
    const usersByEmail = await this.prisma.user.findMany({
      where: {
        email,
        deletedAt: null,
        isActive: true,
      },
      include: {
        tenant: { select: { enforce2FA: true } },
      },
    })

    if (usersByEmail.length === 1) {
      const userByEmail = usersByEmail[0]
      // Check 2FA enforcement
      if (userByEmail.tenant?.enforce2FA && !userByEmail.twoFactorEnabled) {
        throw new UnauthorizedException(
          'Quản trị viên yêu cầu xác thực hai yếu tố. Vui lòng đăng nhập bằng email và thiết lập 2FA trước.',
        )
      }
      const avatar = (supabaseUser.user_metadata?.['avatar_url'] as string) ?? null
      const updateData: Record<string, unknown> = {
        supabaseUserId: supabaseUser.id,
        lastLoginAt: new Date(),
        updatedBy: 'system',
        avatar,
      }
      if (ssoProviderName && ssoId && (!userByEmail.ssoProvider || !userByEmail.ssoId)) {
        updateData.ssoProvider = ssoProviderName
        updateData.ssoId = ssoId
      }
      user = await this.prisma.user.update({
        where: { id: userByEmail.id },
        data: updateData,
      })

      const roles = await this.resolveUserRoles(user.id)
      const accessToken = await this.signAuthToken({
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        roles,
      })

      return {
        accessToken,
        userId: user.id,
        tenantId: user.tenantId,
        roles,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
      }
    }

    if (usersByEmail.length > 1) {
      throw new UnauthorizedException(
        'Không thể xác định tài khoản — email này thuộc về nhiều workspace. Vui lòng liên hệ hỗ trợ.',
      )
    }

    // Check for deactivated account
    const deactivatedUser = await this.prisma.user.findFirst({
      where: {
        email,
        deletedAt: null,
        isActive: false,
      },
    })
    if (deactivatedUser) {
      throw new UnauthorizedException('Tài khoản đã bị vô hiệu hóa')
    }

    // Phase 3: First-time signup
    const fullName = supabaseUser.user_metadata?.['full_name'] as string | undefined
    let firstName = ''
    let lastName = ''
    if (fullName) {
      const lastSpaceIndex = fullName.lastIndexOf(' ')
      if (lastSpaceIndex >= 0) {
        firstName = fullName.substring(0, lastSpaceIndex).trim()
        lastName = fullName.substring(lastSpaceIndex + 1).trim()
      } else {
        firstName = fullName.trim()
      }
    }
    if (!firstName) {
      firstName = email.split('@')[0] ?? 'User'
    }

    const tenantName = dto.tenantName?.trim() || (email.split('@')[1]?.split('.')[0] ?? 'Crm')
    const displayTenantName = tenantName.charAt(0).toUpperCase() + tenantName.slice(1)

    const avatar = (supabaseUser.user_metadata?.['avatar_url'] as string) ?? null

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: displayTenantName },
        })

        const systemRoles = [
          { name: 'ADMIN', description: 'Full system access', dataVisibility: 'ALL' as const },
          {
            name: 'SALES_MANAGER',
            description: 'Sales team manager',
            dataVisibility: 'TEAM' as const,
          },
          {
            name: 'SALES_REP',
            description: 'Sales representative',
            dataVisibility: 'OWN' as const,
          },
          {
            name: 'SUPPORT_AGENT',
            description: 'Customer support agent',
            dataVisibility: 'OWN' as const,
          },
          {
            name: 'MARKETING_USER',
            description: 'Marketing team member',
            dataVisibility: 'OWN' as const,
          },
        ]

        let salesRepRole: { id: string; name: string } | null = null
        const createdRoles: { id: string; name: string }[] = []

        for (const roleDef of systemRoles) {
          const role = await tx.role.create({
            data: {
              tenantId: tenant.id,
              name: roleDef.name,
              description: roleDef.description,
              isSystem: true,
              dataVisibility: roleDef.dataVisibility,
              createdBy: 'system',
              updatedBy: 'system',
            },
          })
          createdRoles.push({ id: role.id, name: role.name })
          if (roleDef.name === 'SALES_REP') {
            salesRepRole = role
          }
        }

        await this.assignDefaultPermissionsForRoles(tx, createdRoles)

        const newUserSsoData: Record<string, unknown> = {}
        if (ssoProviderName && ssoId) {
          newUserSsoData.ssoProvider = ssoProviderName
          newUserSsoData.ssoId = ssoId
        }
        const newUser = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email,
            firstName,
            lastName,
            supabaseUserId: supabaseUser.id,
            avatar,
            isActive: true,
            createdBy: 'system',
            updatedBy: 'system',
            ...newUserSsoData,
          },
        })

        if (salesRepRole) {
          await tx.userRole.create({
            data: {
              userId: newUser.id,
              roleId: salesRepRole.id,
              assignedBy: 'system',
            },
          })
        }

        const roles = salesRepRole ? ['SALES_REP'] : []

        return { user: newUser, roles }
      })

      const accessToken = await this.signAuthToken({
        userId: result.user.id,
        tenantId: result.user.tenantId,
        email: result.user.email,
        roles: result.roles,
      })

      return {
        accessToken,
        userId: result.user.id,
        tenantId: result.user.tenantId,
        roles: result.roles,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        avatar: result.user.avatar,
      }
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already exists in this tenant')
      }
      throw new InternalServerErrorException('Đăng ký Google thất bại — vui lòng thử lại')
    }
  }

  async logout(accessToken: string): Promise<void> {
    await this.supabase.auth.signOut()

    try {
      this.jwtService.verify<JwtPayload>(accessToken)
      this.tokenRevocationService.revoke(accessToken)
    } catch {
      // Token already invalid — logout remains idempotent
    }
  }

  private async buildAuthTokenResponse(
    user: { id: string; tenantId: string; email: string; firstName: string; lastName: string; avatar?: string | null },
    roles: string[],
    backupCodesRemaining?: number,
  ): Promise<AuthTokenResponse> {
    const accessToken = await this.signAuthToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles,
    })

    return {
      accessToken,
      userId: user.id,
      tenantId: user.tenantId,
      roles,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      ...(backupCodesRemaining !== undefined && backupCodesRemaining <= 3
        ? { backupCodesRemaining }
        : {}),
    }
  }

  private respondTwoFactorRequired(userId: string, tenantId: string): TwoFactorRequiredResponse {
    const tempToken = this.jwtService.sign(
      { sub: userId, userId, tenantId, purpose: '2fa_pending' },
      { expiresIn: '5m' },
    )
    return { requires2FA: true, tempToken }
  }

  private respondTwoFactorSetupRequired(userId: string, tenantId: string): TwoFactorSetupRequiredResponse {
    const tempToken = this.jwtService.sign(
      { sub: userId, userId, tenantId, purpose: '2fa_setup' },
      { expiresIn: '15m' },
    )
    return { requires2FASetup: true, tempToken }
  }

  async verify2FALogin(tempToken: string, code: string): Promise<AuthTokenResponse> {
    let payload: { userId: string; tenantId: string; purpose: string }
    try {
      payload = this.jwtService.verify(tempToken)
    } catch {
      throw new UnauthorizedException('2FA session expired — please login again')
    }

    if (payload.purpose !== '2fa_pending') {
      throw new UnauthorizedException('Invalid 2FA session')
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.userId,
        tenantId: payload.tenantId,
        deletedAt: null,
        isActive: true,
      },
    })

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException('2FA is not enabled for this account')
    }

    // Try TOTP first
    const totpValid = await this.twoFactorService.verifyTotp(user.twoFactorSecret, code)

    if (totpValid) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })

      const roles = await this.resolveUserRoles(user.id)
      return this.buildAuthTokenResponse(user, roles)
    }

    // Fallback to backup codes
    const backupCodes = (user.twoFactorBackupCodes as string[]) ?? []
    const usedIndex = await this.twoFactorService.verifyBackupCode(code, backupCodes)

    if (usedIndex >= 0) {
      const updatedCodes = [...backupCodes]
      updatedCodes.splice(usedIndex, 1)
      const backupCodesRemaining = updatedCodes.length

      await this.prisma.user.update({
        where: { id: user.id },
        data: { twoFactorBackupCodes: updatedCodes, lastLoginAt: new Date() },
      })

      const roles = await this.resolveUserRoles(user.id)
      return this.buildAuthTokenResponse(user, roles, backupCodesRemaining)
    }

    throw new UnauthorizedException('Invalid 2FA code')
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) return false

    const { error } = await this.supabase.auth.signInWithPassword({
      email: user.email,
      password,
    })
    return !error
  }

  private withSupabaseAuthTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new BadRequestException(message))
      }, SUPABASE_AUTH_TIMEOUT_MS)

      operation
        .then((value) => {
          clearTimeout(timeout)
          resolve(value)
        })
        .catch((error: unknown) => {
          clearTimeout(timeout)
          reject(error)
        })
    })
  }

  private async assignDefaultPermissionsForRoles(
    tx: {
      permission: {
        findMany: (args: {
          select: { id: boolean; resource: boolean; action: boolean }
        }) => Promise<{ id: string; resource: string; action: string }[]>
      }
      rolePermission: {
        createMany: (args: { data: { roleId: string; permissionId: string }[] }) => Promise<unknown>
      }
    },
    roles: { id: string; name: string }[],
  ): Promise<void> {
    const permissions = await tx.permission.findMany({
      select: { id: true, resource: true, action: true },
    })

    const permMap: Record<string, string> = {}
    for (const p of permissions) {
      permMap[`${p.resource}:${p.action}`] = p.id
    }

    const rolePermissions: { roleId: string; permissionId: string }[] = []

    for (const role of roles) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[role.name] ?? []
      for (const def of defaults) {
        const permId = permMap[`${def.resource}:${def.action}`]
        if (permId) {
          rolePermissions.push({ roleId: role.id, permissionId: permId })
        }
      }
    }

    if (rolePermissions.length > 0) {
      await tx.rolePermission.createMany({ data: rolePermissions })
    }
  }

  private async resolveUserRoles(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, role: { deletedAt: null } },
      include: { role: { select: { name: true } } },
    })
    return userRoles.map((ur) => ur.role.name)
  }

  private async signAuthToken(input: {
    userId: string
    tenantId: string
    email: string
    roles: string[]
  }): Promise<string> {
    const payload: JwtPayload = {
      sub: input.userId,
      userId: input.userId,
      tenantId: input.tenantId,
      roles: input.roles,
      email: input.email,
    }
    return this.jwtService.sign(payload)
  }

  private async cleanupSupabaseUser(supabaseUserId: string): Promise<void> {
    if (!this.supabaseAdmin) {
      throw new InternalServerErrorException(
        'Registration failed and Supabase cleanup is unavailable',
      )
    }

    const { error } = await this.supabaseAdmin.auth.admin.deleteUser(supabaseUserId)
    if (error) {
      throw new InternalServerErrorException('Registration failed and Supabase cleanup failed')
    }
  }
}
