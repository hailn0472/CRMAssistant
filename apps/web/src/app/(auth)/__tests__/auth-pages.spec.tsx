import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ForgotPasswordPage from '../forgot-password/page'
import LoginPage from '../login/page'
import RegisterPage from '../register/page'
import toast from 'react-hot-toast'

import { authService } from '@/services/auth.service'
import { oauthService } from '@/services/oauth.service'
import { useAuth } from '@/hooks/useAuth'

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  useSearchParams: jest.fn(() => ({ get: jest.fn(() => null) })),
}))

jest.mock('@/services/auth.service', () => {
  const mockLogin = jest.fn()
  return {
    authService: {
      forgotPassword: jest.fn(),
      login: mockLogin,
      verify2FALogin: jest.fn(),
      oauthLogin: jest.fn(),
      register: jest.fn(),
      logout: jest.fn(),
    },
  }
})

jest.mock('@/services/oauth.service', () => ({
  oauthService: {
    initiateGoogleOAuth: jest.fn(),
    initiateMicrosoftOAuth: jest.fn(),
  },
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>
const mockAuthService = authService as jest.Mocked<typeof authService>
const mockOAuthService = oauthService as jest.Mocked<typeof oauthService>
const mockToast = toast as jest.Mocked<typeof toast>

describe('Auth pages', () => {
  const defaultLoginResponse = {
    accessToken: 'token',
    userId: 'user-1',
    tenantId: 'tenant-1',
    roles: ['SALES_REP'],
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: jest.fn(),
      register: jest.fn(),
      oauthLogin: jest.fn(),
      logout: jest.fn(),
    })
    mockAuthService.login.mockResolvedValue(defaultLoginResponse)
  })

  it('renders login with password recovery link and accessible fields', () => {
    render(<LoginPage />)

    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('link', { name: 'Quên mật khẩu?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('shows login validation errors linked to fields', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    const email = screen.getByLabelText('Email')
    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-describedby', 'login-email-error')
  })

  it('shows login success feedback while navigation is pending', async () => {
    const user = userEvent.setup()
    const successResponse = {
      accessToken: 'token',
      userId: '1',
      tenantId: '1',
      roles: [],
      email: 'user@example.com',
      firstName: 'User',
      lastName: '',
    }
    mockAuthService.login.mockResolvedValueOnce(successResponse)
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: jest.fn(),
      register: jest.fn(),
      oauthLogin: jest.fn(),
      logout: jest.fn(),
    })
    render(<LoginPage />)

    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.type(screen.getByLabelText('Mật khẩu'), 'Password123')
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'Đăng nhập thành công. Đang mở workspace CRM...',
      )
    })
  })

  it('shows login failure feedback when authentication fails', async () => {
    const user = userEvent.setup()
    mockAuthService.login.mockRejectedValueOnce(new Error('Invalid credentials'))
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: jest.fn(),
      register: jest.fn(),
      oauthLogin: jest.fn(),
      logout: jest.fn(),
    })
    render(<LoginPage />)

    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.type(screen.getByLabelText('Mật khẩu'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Invalid credentials')
    })
  })

  it('renders register with password helper text', () => {
    render(<RegisterPage />)

    expect(screen.getByRole('heading', { name: 'Đăng ký' })).toBeInTheDocument()
    expect(screen.getByText('Mật khẩu cần có ít nhất 8 ký tự.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login')
  })

  it('shows register success feedback while navigation is pending', async () => {
    const user = userEvent.setup()
    const register = jest.fn().mockResolvedValue(undefined)
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: jest.fn(),
      register,
      oauthLogin: jest.fn(),
      logout: jest.fn(),
    })
    render(<RegisterPage />)

    await user.type(screen.getByLabelText('Tên'), 'Van')
    await user.type(screen.getByLabelText('Họ'), 'Nguyen')
    await user.type(screen.getByLabelText('Tên công ty'), 'ACME')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.type(screen.getByLabelText('Mật khẩu'), 'Password123')
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Đăng ký thành công. Đang mở workspace CRM...')
    })
  })

  it('shows register failure feedback when registration fails', async () => {
    const user = userEvent.setup()
    const register = jest.fn().mockRejectedValue(new Error('Registration timed out'))
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: jest.fn(),
      register,
      oauthLogin: jest.fn(),
      logout: jest.fn(),
    })
    render(<RegisterPage />)

    await user.type(screen.getByLabelText('Tên'), 'Van')
    await user.type(screen.getByLabelText('Họ'), 'Nguyen')
    await user.type(screen.getByLabelText('Tên công ty'), 'ACME')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.type(screen.getByLabelText('Mật khẩu'), 'Password123')
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Registration timed out')
    })
  })

  it('submits forgot password and shows enumeration-safe success copy', async () => {
    const user = userEvent.setup()
    mockAuthService.forgotPassword.mockResolvedValue(undefined)
    render(<ForgotPasswordPage />)

    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: 'Gửi hướng dẫn khôi phục' }))

    await waitFor(() => {
      expect(mockAuthService.forgotPassword).toHaveBeenCalledWith('user@example.com')
    })
    expect(
      await screen.findByText(
        'Nếu email này tồn tại trong hệ thống, hướng dẫn khôi phục mật khẩu sẽ được gửi trong vài phút.',
      ),
    ).toBeInTheDocument()
  })

  it('shows forgot password validation and server errors', async () => {
    const user = userEvent.setup()
    mockAuthService.forgotPassword.mockRejectedValue(new Error('Không thể gửi email lúc này'))
    render(<ForgotPasswordPage />)

    await user.click(screen.getByRole('button', { name: 'Gửi hướng dẫn khôi phục' }))
    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: 'Gửi hướng dẫn khôi phục' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể gửi email lúc này')
  })

  describe('Google OAuth button', () => {
    it('renders "Continue with Google" button on login page', () => {
      render(<LoginPage />)
      expect(screen.getByText('Tiếp tục với Google')).toBeInTheDocument()
    })

    it('renders "Continue with Google" button on register page', () => {
      render(<RegisterPage />)
      expect(screen.getByText('Tiếp tục với Google')).toBeInTheDocument()
    })

    it('calls initiateGoogleOAuth when Google button is clicked on login', async () => {
      const user = userEvent.setup()
      mockOAuthService.initiateGoogleOAuth.mockResolvedValue(undefined)
      render(<LoginPage />)

      await user.click(screen.getByText('Tiếp tục với Google'))

      expect(mockOAuthService.initiateGoogleOAuth).toHaveBeenCalled()
    })

    it('shows toast error when OAuth initiation fails', async () => {
      const user = userEvent.setup()
      mockOAuthService.initiateGoogleOAuth.mockRejectedValue(
        new Error('Không thể khởi tạo đăng nhập Google — vui lòng thử lại'),
      )
      render(<LoginPage />)

      await user.click(screen.getByText('Tiếp tục với Google'))

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          'Không thể khởi tạo đăng nhập Google — vui lòng thử lại',
        )
      })
    })
  })
})
