export type UserRole = 'ADMIN' | 'MANAGER' | 'SALES_REP'

export type AuthUser = {
  userId: string
  tenantId: string
  role: UserRole
  email: string
  name: string
}

export type AuthTokenResponse = {
  accessToken: string
  userId: string
  tenantId: string
  role: UserRole
  email: string
  name: string
}

export type LoginCredentials = {
  email: string
  password: string
}

export type RegisterData = {
  email: string
  password: string
  name: string
  tenantName: string
}
