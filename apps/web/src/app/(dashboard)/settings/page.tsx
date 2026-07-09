'use client'

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import toast from 'react-hot-toast'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WorkspaceHeader } from '@/components/layout/AppShell'
import { TwoFactorSetup } from '@/components/settings/TwoFactorSetup'
import { BackupCodesDisplay } from '@/components/settings/BackupCodesDisplay'
import { twoFactorService } from '@/services/two-factor.service'
import { oauthService } from '@/services/oauth.service'

const passwordSchema = z.object({
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})

type TwoFactorState = 'disabled' | 'showing_qr' | 'showing_codes' | 'enabled'

export default function SettingsPage(): React.JSX.Element {
  const [twoFactorState, setTwoFactorState] = useState<TwoFactorState>('disabled')
  const [setupData, setSetupData] = useState<{
    secret: string
    qrCodeDataUrl: string
    backupCodes: string[]
  } | null>(null)
  const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false)
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false)
  const [ssoProvider, setSsoProvider] = useState<string | null>(null)

  useEffect(() => {
    twoFactorService.getCurrentUser().then((user) => {
      setSsoProvider(user.ssoProvider ?? null)
    }).catch(() => { /* non-critical */ })
  }, [])

  const passwordForm = useForm<{ password: string }>({
    resolver: zodResolver(passwordSchema),
  })

  const is2FAEnabled = twoFactorState === 'enabled'

  const handleEnable2FA = useCallback(async (): Promise<void> => {
    try {
      const result = await twoFactorService.enable2FA()
      setSetupData(result)
      setTwoFactorState('showing_qr')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể bật 2FA')
    }
  }, [])

  const handleVerify2FA = useCallback(
    async (code: string): Promise<{ success: boolean }> => {
      const result = await twoFactorService.verify2FA(code)
      if (result.success) {
        setTwoFactorState('showing_codes')
      }
      return result
    },
    [],
  )

  const handleBackupCodesConfirmed = useCallback((): void => {
    setTwoFactorState('enabled')
    setSetupData(null)
    toast.success('2FA đã được bật')
  }, [])

  const handleDisableSubmit = useCallback(
    async (data: { password: string }): Promise<void> => {
      try {
        await twoFactorService.disable2FA(data.password)
        setTwoFactorState('disabled')
        setIsDisableDialogOpen(false)
        passwordForm.reset()
        toast.success('2FA đã được tắt')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không thể tắt 2FA')
      }
    },
    [passwordForm],
  )

  const handleRegenerateSubmit = useCallback(
    async (data: { password: string }): Promise<void> => {
      try {
        const codes = await twoFactorService.regenerateBackupCodes(data.password)
        setSetupData({ secret: '', qrCodeDataUrl: '', backupCodes: codes })
        setIsRegenerateDialogOpen(false)
        setTwoFactorState('showing_codes')
        passwordForm.reset()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không thể tạo mã dự phòng mới')
      }
    },
    [passwordForm],
  )

  const handleGoogleConnect = useCallback(async (): Promise<void> => {
    try {
      await oauthService.initiateGoogleOAuth()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể kết nối Google')
    }
  }, [])

  const handleMicrosoftConnect = useCallback(async (): Promise<void> => {
    try {
      await oauthService.initiateMicrosoftOAuth()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể kết nối Microsoft')
    }
  }, [])

  return (
    <div className="space-y-6">
      <WorkspaceHeader
        eyebrow="Workspace"
        title="Cài đặt"
        description="Quản lý cài đặt hệ thống, bảo mật tài khoản và xác thực hai yếu tố."
      />

      {/* Two-Factor Authentication Section */}
      <Card>
        <CardHeader>
          <CardTitle>Xác thực hai yếu tố (2FA)</CardTitle>
          <CardDescription>
            Thêm một lớp bảo vệ cho tài khoản của bạn bằng mã xác thực từ ứng dụng authenticator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {twoFactorState === 'disabled' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Trạng thái: <span className="font-medium text-slate-800">Chưa bật</span>
              </p>
              <Button type="button" onClick={handleEnable2FA}>
                Bật xác thực hai yếu tố
              </Button>
            </div>
          )}

          {twoFactorState === 'showing_qr' && setupData && (
            <TwoFactorSetup
              secret={setupData.secret}
              qrCodeDataUrl={setupData.qrCodeDataUrl}
              backupCodes={setupData.backupCodes}
              onVerify={handleVerify2FA}
              onCancel={() => { setTwoFactorState('disabled'); setSetupData(null) }}
            />
          )}

          {twoFactorState === 'showing_codes' && setupData && (
            <BackupCodesDisplay
              codes={setupData.backupCodes}
              onConfirmed={handleBackupCodesConfirmed}
            />
          )}

          {is2FAEnabled && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Trạng thái: <span className="font-medium text-green-600">Đã bật</span>
              </p>

              {!isDisableDialogOpen && !isRegenerateDialogOpen && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsRegenerateDialogOpen(true)}
                  >
                    Tạo mã dự phòng mới
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setIsDisableDialogOpen(true)}
                  >
                    Tắt 2FA
                  </Button>
                </div>
              )}

              {isDisableDialogOpen && (
                <form
                  onSubmit={passwordForm.handleSubmit(handleDisableSubmit)}
                  className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4"
                >
                  <p className="text-sm font-medium text-red-800">
                    Nhập mật khẩu để tắt xác thực hai yếu tố
                  </p>
                  <Input
                    type="password"
                    placeholder="Mật khẩu"
                    {...passwordForm.register('password')}
                  />
                  {passwordForm.formState.errors.password && (
                    <p className="text-sm text-destructive" role="alert">
                      {passwordForm.formState.errors.password.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { setIsDisableDialogOpen(false); passwordForm.reset() }}
                    >
                      Hủy
                    </Button>
                    <Button type="submit" variant="destructive" disabled={passwordForm.formState.isSubmitting}>
                      {passwordForm.formState.isSubmitting ? 'Đang xử lý...' : 'Xác nhận tắt 2FA'}
                    </Button>
                  </div>
                </form>
              )}

              {isRegenerateDialogOpen && (
                <form
                  onSubmit={passwordForm.handleSubmit(handleRegenerateSubmit)}
                  className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4"
                >
                  <p className="text-sm font-medium text-amber-800">
                    Nhập mật khẩu để tạo mã dự phòng mới
                  </p>
                  <Input
                    type="password"
                    placeholder="Mật khẩu"
                    {...passwordForm.register('password')}
                  />
                  {passwordForm.formState.errors.password && (
                    <p className="text-sm text-destructive" role="alert">
                      {passwordForm.formState.errors.password.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { setIsRegenerateDialogOpen(false); passwordForm.reset() }}
                    >
                      Hủy
                    </Button>
                    <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                      {passwordForm.formState.isSubmitting ? 'Đang xử lý...' : 'Tạo mã mới'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connected Accounts Section */}
      <Card>
        <CardHeader>
          <CardTitle>Tài khoản liên kết</CardTitle>
          <CardDescription>
            Kết nối tài khoản của bạn với các dịch vụ SSO để đăng nhập nhanh hơn.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-slate-200 p-3">
            <div className="flex items-center gap-3">
              <svg className="h-6 w-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <div>
                <p className="text-sm font-medium text-slate-800">Google</p>
                {ssoProvider === 'GOOGLE' ? (
                  <p className="text-xs text-green-600">Đã kết nối</p>
                ) : (
                  <p className="text-xs text-slate-500">Đăng nhập nhanh với tài khoản Google</p>
                )}
              </div>
            </div>
            {ssoProvider === 'GOOGLE' ? (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                Đã liên kết
              </span>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={handleGoogleConnect}>
                Kết nối
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border border-slate-200 p-3">
            <div className="flex items-center gap-3">
              <svg className="h-6 w-6" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
                <rect width="23" height="23" rx="4" fill="#00A4EF" />
                <path d="M5 5h6v6H5V5zm7 0h6v6h-6V5zm-7 7h6v6H5v-6zm7 0h6v6h-6v-6z" fill="#fff" />
              </svg>
              <div>
                <p className="text-sm font-medium text-slate-800">Microsoft</p>
                {ssoProvider === 'AZURE_AD' ? (
                  <p className="text-xs text-green-600">Đã kết nối</p>
                ) : (
                  <p className="text-xs text-slate-500">Đăng nhập nhanh với tài khoản Microsoft</p>
                )}
              </div>
            </div>
            {ssoProvider === 'AZURE_AD' ? (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                Đã liên kết
              </span>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={handleMicrosoftConnect}>
                Kết nối
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
