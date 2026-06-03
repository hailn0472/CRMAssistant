import type {
  AuthTokenResponse,
  ForgotPasswordData,
  LoginCredentials,
  RegisterData,
} from '../types/auth.types'

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return response.statusText || fallback
  }

  try {
    const error = (await response.json()) as { message?: unknown }
    return typeof error.message === 'string' ? error.message : fallback
  } catch {
    return fallback
  }
}

export const authService = {
  async register(data: RegisterData): Promise<AuthTokenResponse> {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response, 'Registration failed'))
    }

    return response.json() as Promise<AuthTokenResponse>
  },

  async login(credentials: LoginCredentials): Promise<AuthTokenResponse> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    })

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response, 'Login failed'))
    }

    return response.json() as Promise<AuthTokenResponse>
  },

  async forgotPassword(email: string): Promise<void> {
    const data: ForgotPasswordData = { email }
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response, 'Password recovery failed'))
    }
  },

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
