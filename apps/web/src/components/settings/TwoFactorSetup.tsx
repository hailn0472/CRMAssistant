'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface TwoFactorSetupProps {
  secret: string
  qrCodeDataUrl: string
  backupCodes: string[]
  onVerify: (code: string) => Promise<{ success: boolean }>
  onCancel: () => void
}

export function TwoFactorSetup({
  secret,
  qrCodeDataUrl,
  onVerify,
  onCancel,
}: TwoFactorSetupProps): React.JSX.Element {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleVerify = async (): Promise<void> => {
    if (code.length !== 6) return
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await onVerify(code)
      if (!result.success) {
        setError('Mã xác thực không đúng')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xác thực thất bại')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm font-medium text-slate-700">Thiết lập xác thực hai yếu tố</p>
        <p className="mt-1 text-xs text-slate-500">
          Quét mã QR bên dưới bằng ứng dụng xác thực (Google Authenticator, Authy, Microsoft Authenticator)
        </p>
      </div>

      {qrCodeDataUrl && (
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrCodeDataUrl}
            alt="QR Code for 2FA"
            className="h-48 w-48"
          />
        </div>
      )}

      <div className="rounded-md bg-slate-50 p-3 text-center">
        <p className="text-xs font-medium text-slate-500">Hoặc nhập mã thủ công</p>
        <p className="mt-1 font-mono text-sm text-slate-700 select-all">{secret}</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="verify-code">
          Mã xác thực 6 chữ số
        </label>
        <Input
          id="verify-code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoComplete="one-time-code"
        />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          Hủy
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={handleVerify}
          disabled={isSubmitting || code.length !== 6}
        >
          {isSubmitting ? 'Đang xác thực...' : 'Xác thực'}
        </Button>
      </div>
    </div>
  )
}
