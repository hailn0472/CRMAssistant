export type Role = {
  id: string
  name: string
  description?: string | null
  isSystem: boolean
}

export type AuthUser = {
  userId: string
  tenantId: string
  roles: string[]
  email: string
  firstName: string
  lastName: string
  avatar?: string | null
}

export type AuthTokenResponse = {
  accessToken: string
  userId: string
  tenantId: string
  roles: string[]
  email: string
  firstName: string
  lastName: string
  avatar?: string | null
  backupCodesRemaining?: number
}

export type TwoFactorRequiredResponse = {
  requires2FA: true
  tempToken: string
}

export type TwoFactorSetupRequiredResponse = {
  requires2FASetup: true
  tempToken: string
}

export type LoginResponse = AuthTokenResponse | TwoFactorRequiredResponse | TwoFactorSetupRequiredResponse

export type LoginCredentials = {
  email: string
  password: string
}

export type ForgotPasswordData = {
  email: string
}

export type RegisterData = {
  email: string
  password: string
  firstName: string
  lastName: string
  tenantName: string
}

export type Permission = {
  id: string
  resource: string
  action: string
  description?: string | null
}

export type PermissionCheck = {
  resource: string
  action: string
  granted: boolean
}

export type Team = {
  id: string
  name: string
  managerId?: string | null
  manager?: {
    id: string
    firstName: string
    lastName: string
  } | null
  memberCount?: number
  _count?: { members: number }
}
