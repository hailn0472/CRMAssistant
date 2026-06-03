import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ForgotPasswordPage from '../forgot-password/page'
import LoginPage from '../login/page'
import RegisterPage from '../register/page'
import { authService } from '@/services/auth.service'
import { useAuth } from '@/hooks/useAuth'

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}))

jest.mock('@/services/auth.service', () => ({
  authService: {
    forgotPassword: jest.fn(),
  },
}))

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>
const mockAuthService = authService as jest.Mocked<typeof authService>

describe('Auth pages', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: jest.fn(),
      register: jest.fn(),
      logout: jest.fn(),
    })
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

  it('renders register with password helper text', () => {
    render(<RegisterPage />)

    expect(screen.getByRole('heading', { name: 'Đăng ký' })).toBeInTheDocument()
    expect(screen.getByText('Mật khẩu cần có ít nhất 8 ký tự.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login')
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
})
