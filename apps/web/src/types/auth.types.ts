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
}

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
