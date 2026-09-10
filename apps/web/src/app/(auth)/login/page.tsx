'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { authService } from '@/services/auth.service'
import { oauthService } from '@/services/oauth.service'
import { TwoFactorVerification } from '@/components/auth/TwoFactorVerification'
import { TwoFactorSetup } from '@/components/settings/TwoFactorSetup'
import { BackupCodesDisplay } from '@/components/settings/BackupCodesDisplay'
import { twoFactorService } from '@/services/two-factor.service'

const loginSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})

type LoginFormData = z.infer<typeof loginSchema>

type LoginStep = 'credentials' | '2fa' | '2fa-setup'

function LoginForm(): React.JSX.Element {
  const { login } = useAuth()
  const searchParams = useSearchParams()

  const [step, setStep] = useState<LoginStep>('credentials')
  const [tempToken, setTempToken] = useState<string | null>(null)
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null)
  const [is2FASubmitting, setIs2FASubmitting] = useState(false)
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number | undefined>(undefined)
  const [pendingCredentials, setPendingCredentials] = useState<{
    email: string
    password: string
  } | null>(null)

  // OAuth error handling — shows toast when redirected from OAuth callback with error
  const oauthError = searchParams.get('error')
  useEffect(() => {
    if (oauthError === 'oauth_failed') {
      toast.error('Đăng nhập với Google thất bại — vui lòng thử lại')
    }
  }, [oauthError])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    clearErrors,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginFormData): Promise<void> => {
    clearErrors('root')
    try {
      const response = await authService.login({ email: data.email, password: data.password })

      if ('requires2FA' in response) {
        setTempToken(response.tempToken)
        setStep('2fa')
        return
      }

      if ('requires2FASetup' in response) {
        setTempToken(response.tempToken)
        setPendingCredentials({ email: data.email, password: data.password })
        setStep('2fa-setup')
        return
      }

      // Standard login — use first response directly, avoid duplicate API call
      const authUser = {
        userId: response.userId,
        tenantId: response.tenantId,
        roles: response.roles,
        email: response.email,
        firstName: response.firstName,
        lastName: response.lastName,
        avatar: response.avatar,
      }
      const { useAuthStore } = await import('@/stores/auth.store')
      useAuthStore.getState().setUser(authUser)
      useAuthStore.getState().setAccessToken(response.accessToken)
      toast.success('Đăng nhập thành công. Đang mở workspace CRM...')
      window.location.href = '/dashboard'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Đăng nhập thất bại'
      setError('root', { message })
      toast.error(message)
    }
  }

  const handle2FASubmit = useCallback(
    async (code: string): Promise<void> => {
      if (!tempToken) return
      setIs2FASubmitting(true)
      setTwoFactorError(null)
      try {
        const response = await authService.verify2FALogin(tempToken, code)
        if ('backupCodesRemaining' in response && response.backupCodesRemaining !== undefined) {
          setBackupCodesRemaining(response.backupCodesRemaining)
        }
        // Use the existing login mechanism - store the auth data and redirect
        const authUser = {
          userId: response.userId,
          tenantId: response.tenantId,
          roles: response.roles,
          email: response.email,
          firstName: response.firstName,
          lastName: response.lastName,
          avatar: response.avatar,
        }
        const { useAuthStore } = await import('@/stores/auth.store')
        useAuthStore.getState().setUser(authUser)
        useAuthStore.getState().setAccessToken(response.accessToken)
        const redirect = searchParams.get('redirect')
        const safeRedirect =
          redirect?.startsWith('/') && !redirect.startsWith('//') && !redirect.includes('\\')
            ? redirect
            : '/dashboard'
        window.location.href = safeRedirect
      } catch (err) {
        setTwoFactorError(err instanceof Error ? err.message : 'Mã xác thực không đúng')
      } finally {
        setIs2FASubmitting(false)
      }
    },
    [tempToken, searchParams],
  )

  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [isMicrosoftSubmitting, setIsMicrosoftSubmitting] = useState(false)

  const handleGoogleLogin = useCallback(async (): Promise<void> => {
    if (isGoogleSubmitting) return
    setIsGoogleSubmitting(true)
    try {
      await oauthService.initiateGoogleOAuth(searchParams.get('redirect') ?? undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể đăng nhập với Google'
      toast.error(message)
      setIsGoogleSubmitting(false)
    }
  }, [isGoogleSubmitting, searchParams])

  const handleMicrosoftLogin = useCallback(async (): Promise<void> => {
    if (isMicrosoftSubmitting) return
    setIsMicrosoftSubmitting(true)
    try {
      await oauthService.initiateMicrosoftOAuth(searchParams.get('redirect') ?? undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể đăng nhập với Microsoft'
      toast.error(message)
      setIsMicrosoftSubmitting(false)
    }
  }, [isMicrosoftSubmitting, searchParams])

  if (step === '2fa') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-950">
        <Card className="w-full max-w-md border-slate-200 bg-white shadow-sm">
          <CardHeader className="space-y-2 text-center">
            <CardTitle
              className="text-2xl font-semibold tracking-tight"
              role="heading"
              aria-level={1}
            >
              Xác thực hai yếu tố
            </CardTitle>
            <CardDescription className="text-slate-600">
              Nhập mã 6 chữ số từ ứng dụng xác thực của bạn
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TwoFactorVerification
              onSubmit={handle2FASubmit}
              isSubmitting={is2FASubmitting}
              error={twoFactorError}
              backupCodesRemaining={backupCodesRemaining}
            />
          </CardContent>
        </Card>
      </main>
    )
  }

  if (step === '2fa-setup') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-950">
        <Card className="w-full max-w-md border-slate-200 bg-white shadow-sm">
          <CardHeader className="space-y-2 text-center">
            <CardTitle
              className="text-2xl font-semibold tracking-tight"
              role="heading"
              aria-level={1}
            >
              Thiết lập 2FA bắt buộc
            </CardTitle>
            <CardDescription className="text-slate-600">
              Quản trị viên yêu cầu xác thực hai yếu tố. Vui lòng thiết lập trước khi tiếp tục.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Enable2FASetupWizard
              onComplete={async () => {
                if (pendingCredentials) {
                  try {
                    await authService.login(pendingCredentials)
                    await login(pendingCredentials.email, pendingCredentials.password)
                  } catch {
                    window.location.href = '/login'
                  }
                } else {
                  window.location.href = '/dashboard'
                }
              }}
            />
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-950">
      <Card className="w-full max-w-md border-slate-200 bg-white shadow-sm">
        <CardHeader className="space-y-2 text-center">
          <CardTitle
            className="text-2xl font-semibold tracking-tight"
            role="heading"
            aria-level={1}
          >
            Đăng nhập
          </CardTitle>
          <CardDescription className="text-slate-600">
            Nhập thông tin đăng nhập để truy cập CRMAssistant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-800" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="ban@example.com"
                autoComplete="email"
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                aria-invalid={errors.email ? 'true' : 'false'}
                {...register('email')}
              />
              {errors.email && (
                <p id="login-email-error" className="text-sm text-destructive" role="alert">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-slate-800" htmlFor="password">
                  Mật khẩu
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-blue-700 hover:underline"
                >
                  Quên mật khẩu?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                aria-invalid={errors.password ? 'true' : 'false'}
                {...register('password')}
              />
              {errors.password && (
                <p id="login-password-error" className="text-sm text-destructive" role="alert">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </Button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-500">hoặc</span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 h-11 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleGoogleLogin}
              disabled={isGoogleSubmitting}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Tiếp tục với Google
            </button>

            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 h-11 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleMicrosoftLogin}
              disabled={isMicrosoftSubmitting}
            >
              <svg className="h-5 w-5" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
                <rect width="23" height="23" rx="4" fill="#00A4EF" />
                <path d="M5 5h6v6H5V5zm7 0h6v6h-6V5zm-7 7h6v6H5v-6zm7 0h6v6h-6v-6z" fill="#fff" />
              </svg>
              Tiếp tục với Microsoft
            </button>
          </div>

          <div className="mt-5 text-center text-sm text-slate-600">
            Chưa có tài khoản?{' '}
            <Link href="/register" className="font-medium text-blue-700 hover:underline">
              Đăng ký ngay
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

// Separate component for the enforced 2FA setup wizard during login
function Enable2FASetupWizard({
  onComplete,
}: {
  onComplete: () => void
}): React.JSX.Element | null {
  const [setupData, setSetupData] = useState<{
    secret: string
    qrCodeDataUrl: string
    backupCodes: string[]
  } | null>(null)
  const [step, setStep] = useState<'init' | 'qr' | 'codes'>('init')

  const handleStart = useCallback(async (): Promise<void> => {
    try {
      const result = await twoFactorService.enable2FA()
      setSetupData(result)
      setStep('qr')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể bắt đầu thiết lập 2FA')
    }
  }, [])

  const handleVerify = useCallback(async (code: string): Promise<{ success: boolean }> => {
    try {
      const result = await twoFactorService.verify2FA(code)
      if (result.success) {
        setStep('codes')
      }
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xác thực thất bại')
      return { success: false }
    }
  }, [])

  if (step === 'init') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Bạn cần thiết lập xác thực hai yếu tố trước khi có thể tiếp tục.
        </p>
        <Button type="button" className="w-full" onClick={handleStart}>
          Bắt đầu thiết lập
        </Button>
      </div>
    )
  }

  if (step === 'qr' && setupData) {
    return (
      <TwoFactorSetup
        secret={setupData.secret}
        qrCodeDataUrl={setupData.qrCodeDataUrl}
        backupCodes={setupData.backupCodes}
        onVerify={handleVerify}
        onCancel={() => setStep('init')}
      />
    )
  }

  if (step === 'codes' && setupData) {
    return <BackupCodesDisplay codes={setupData.backupCodes} onConfirmed={onComplete} />
  }

  return null
}

export default function LoginPage(): React.JSX.Element {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
