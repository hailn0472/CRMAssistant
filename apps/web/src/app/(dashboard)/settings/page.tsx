'use client'

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import toast from 'react-hot-toast'
import { z } from 'zod'

import { Input } from '@/components/ui/input'
import { TwoFactorSetup } from '@/components/settings/TwoFactorSetup'
import { BackupCodesDisplay } from '@/components/settings/BackupCodesDisplay'
import { twoFactorService } from '@/services/two-factor.service'
import { oauthService } from '@/services/oauth.service'

const passwordSchema = z.object({
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})

type TwoFactorState = 'disabled' | 'showing_qr' | 'showing_codes' | 'enabled'

const buttonPrimary =
  'inline-flex h-9 shrink-0 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60'
const buttonSecondary =
  'inline-flex h-8 items-center rounded-[8px] border border-[#e6e6eb] bg-white px-3 text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]'
const buttonDestructive =
  'inline-flex h-9 items-center rounded-[9px] border border-red-200 bg-red-50 px-3.5 text-[13px] font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60'

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
    twoFactorService
      .getCurrentUser()
      .then((user) => {
        setSsoProvider(user.ssoProvider ?? null)
      })
      .catch(() => {
        /* non-critical */
      })
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

  const handleVerify2FA = useCallback(async (code: string): Promise<{ success: boolean }> => {
    const result = await twoFactorService.verify2FA(code)
    if (result.success) {
      setTwoFactorState('showing_codes')
    }
    return result
  }, [])

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
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">Security</h1>
        <p className="max-w-[60ch] text-[13.5px] text-[#77777f]">
          Bảo vệ tài khoản của bạn bằng xác thực hai yếu tố và đăng nhập SSO.
        </p>
      </div>

      {/* Two-Factor Authentication Section */}
      <section className="flex flex-col gap-4 rounded-[14px] border border-[#ececf0] bg-white px-[22px] py-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[14.5px] font-semibold text-[#1b1b1f]">
              Xác thực hai yếu tố (2FA)
            </h2>
            <p className="max-w-[52ch] text-[12.5px] text-[#8c8c96]">
              Thêm một lớp bảo vệ cho tài khoản của bạn bằng mã xác thực từ ứng dụng authenticator.
            </p>
            <span
              className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] font-medium"
              style={{ color: is2FAEnabled ? '#22a06b' : '#c2860a' }}
            >
              <span
                className="block h-1.5 w-1.5 rounded-full"
                style={{ background: is2FAEnabled ? '#22a06b' : '#c2860a' }}
              />
              {is2FAEnabled ? 'Đã bật' : 'Chưa bật'}
            </span>
          </div>
          {twoFactorState === 'disabled' ? (
            <button type="button" onClick={handleEnable2FA} className={buttonPrimary}>
              Bật xác thực hai yếu tố
            </button>
          ) : null}
        </div>

        {twoFactorState === 'showing_qr' && setupData && (
          <TwoFactorSetup
            secret={setupData.secret}
            qrCodeDataUrl={setupData.qrCodeDataUrl}
            backupCodes={setupData.backupCodes}
            onVerify={handleVerify2FA}
            onCancel={() => {
              setTwoFactorState('disabled')
              setSetupData(null)
            }}
          />
        )}

        {twoFactorState === 'showing_codes' && setupData && (
          <BackupCodesDisplay
            codes={setupData.backupCodes}
            onConfirmed={handleBackupCodesConfirmed}
          />
        )}

        {is2FAEnabled && (
          <div className="flex flex-col gap-4 border-t border-[#f2f2f5] pt-4">
            {!isDisableDialogOpen && !isRegenerateDialogOpen && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIsRegenerateDialogOpen(true)}
                  className={buttonSecondary}
                >
                  Tạo mã dự phòng mới
                </button>
                <button
                  type="button"
                  onClick={() => setIsDisableDialogOpen(true)}
                  className="inline-flex h-8 items-center rounded-[8px] border border-red-200 bg-white px-3 text-[12.5px] font-medium text-red-700 transition-colors hover:bg-red-50"
                >
                  Tắt 2FA
                </button>
              </div>
            )}

            {isDisableDialogOpen && (
              <form
                onSubmit={passwordForm.handleSubmit(handleDisableSubmit)}
                className="flex flex-col gap-3 rounded-[9px] border border-red-200 bg-red-50 p-4"
              >
                <p className="text-[13px] font-medium text-red-800">
                  Nhập mật khẩu để tắt xác thực hai yếu tố
                </p>
                <Input
                  type="password"
                  placeholder="Mật khẩu"
                  {...passwordForm.register('password')}
                />
                {passwordForm.formState.errors.password && (
                  <p className="text-[13px] text-destructive" role="alert">
                    {passwordForm.formState.errors.password.message}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDisableDialogOpen(false)
                      passwordForm.reset()
                    }}
                    className={buttonSecondary}
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={passwordForm.formState.isSubmitting}
                    className={buttonDestructive}
                  >
                    {passwordForm.formState.isSubmitting ? 'Đang xử lý...' : 'Xác nhận tắt 2FA'}
                  </button>
                </div>
              </form>
            )}

            {isRegenerateDialogOpen && (
              <form
                onSubmit={passwordForm.handleSubmit(handleRegenerateSubmit)}
                className="flex flex-col gap-3 rounded-[9px] border border-amber-200 bg-amber-50 p-4"
              >
                <p className="text-[13px] font-medium text-amber-800">
                  Nhập mật khẩu để tạo mã dự phòng mới
                </p>
                <Input
                  type="password"
                  placeholder="Mật khẩu"
                  {...passwordForm.register('password')}
                />
                {passwordForm.formState.errors.password && (
                  <p className="text-[13px] text-destructive" role="alert">
                    {passwordForm.formState.errors.password.message}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRegenerateDialogOpen(false)
                      passwordForm.reset()
                    }}
                    className={buttonSecondary}
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={passwordForm.formState.isSubmitting}
                    className={buttonPrimary}
                  >
                    {passwordForm.formState.isSubmitting ? 'Đang xử lý...' : 'Tạo mã mới'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>

      {/* Connected Accounts Section */}
      <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
        <div className="flex flex-col gap-1 border-b border-[#f2f2f5] px-[22px] py-4">
          <h2 className="text-[14.5px] font-semibold text-[#1b1b1f]">Tài khoản liên kết</h2>
          <p className="text-[12.5px] text-[#8c8c96]">
            Kết nối tài khoản của bạn với các dịch vụ SSO để đăng nhập nhanh hơn.
          </p>
        </div>

        <div className="flex items-center gap-3.5 border-b border-[#f4f4f7] px-[22px] py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#ececf0] bg-[#fafafb]">
            <svg
              className="h-[18px] w-[18px]"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
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
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13.5px] font-medium text-[#1b1b1f]">Google</span>
            {ssoProvider === 'GOOGLE' ? (
              <span className="text-[11.5px] text-[#22a06b]">Đã kết nối</span>
            ) : (
              <span className="text-[11.5px] text-[#a0a0aa]">
                Đăng nhập nhanh với tài khoản Google
              </span>
            )}
          </div>
          {ssoProvider === 'GOOGLE' ? (
            <span className="ml-auto shrink-0 rounded-full bg-[#eaf6ef] px-2.5 py-0.5 text-[12px] font-medium text-[#22a06b]">
              Đã liên kết
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleGoogleConnect()}
              className={`ml-auto shrink-0 ${buttonSecondary}`}
            >
              Kết nối
            </button>
          )}
        </div>

        <div className="flex items-center gap-3.5 px-[22px] py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#ececf0] bg-[#fafafb]">
            <svg
              className="h-[18px] w-[18px]"
              viewBox="0 0 23 23"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect width="23" height="23" rx="4" fill="#00A4EF" />
              <path d="M5 5h6v6H5V5zm7 0h6v6h-6V5zm-7 7h6v6H5v-6zm7 0h6v6h-6v-6z" fill="#fff" />
            </svg>
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13.5px] font-medium text-[#1b1b1f]">Microsoft</span>
            {ssoProvider === 'AZURE_AD' ? (
              <span className="text-[11.5px] text-[#22a06b]">Đã kết nối</span>
            ) : (
              <span className="text-[11.5px] text-[#a0a0aa]">
                Đăng nhập nhanh với tài khoản Microsoft
              </span>
            )}
          </div>
          {ssoProvider === 'AZURE_AD' ? (
            <span className="ml-auto shrink-0 rounded-full bg-[#eaf6ef] px-2.5 py-0.5 text-[12px] font-medium text-[#22a06b]">
              Đã liên kết
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleMicrosoftConnect()}
              className={`ml-auto shrink-0 ${buttonSecondary}`}
            >
              Kết nối
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
