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
import type { LoginDto } from './dto/login.dto'
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
          { name: 'ADMIN', description: 'Full system access' },
          { name: 'SALES_MANAGER', description: 'Sales team manager' },
          { name: 'SALES_REP', description: 'Sales representative' },
          { name: 'SUPPORT_AGENT', description: 'Customer support agent' },
          { name: 'MARKETING_USER', description: 'Marketing team member' },
        ]

        let salesRepRole: { id: string } | null = null

        for (const roleDef of systemRoles) {
          const role = await tx.role.create({
            data: {
              tenantId: tenant.id,
              name: roleDef.name,
              description: roleDef.description,
              isSystem: true,
              createdBy: 'system',
              updatedBy: 'system',
            },
          })
          if (roleDef.name === 'SALES_REP') {
            salesRepRole = role
          }
        }

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

  async login(dto: LoginDto): Promise<AuthTokenResponse> {
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
    })

    if (!user) {
      const usersByEmail = await this.prisma.user.findMany({
        where: {
          email: dto.email,
          deletedAt: null,
          isActive: true,
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
        data: { supabaseUserId: supabaseData.user.id, updatedBy: 'system' },
      })

      // Set lastLoginAt
      await this.prisma.user.update({
        where: { id: linkedUser.id },
        data: { lastLoginAt: new Date() },
      })

      const roles = await this.resolveUserRoles(linkedUser.id)

      const accessToken = await this.signAuthToken({
        userId: linkedUser.id,
        tenantId: linkedUser.tenantId,
        email: linkedUser.email,
        roles,
      })

      return {
        accessToken,
        userId: linkedUser.id,
        tenantId: linkedUser.tenantId,
        roles,
        email: linkedUser.email,
        firstName: linkedUser.firstName,
        lastName: linkedUser.lastName,
        avatar: linkedUser.avatar,
      }
    }

    // Set lastLoginAt
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
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
