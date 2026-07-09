'use client'

import { useCallback, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CODE_LENGTH = 6

interface TwoFactorVerificationProps {
  onSubmit: (code: string) => Promise<void>
  isSubmitting: boolean
  error: string | null
  backupCodesRemaining?: number
}

export function TwoFactorVerification({
  onSubmit,
  isSubmitting,
  error,
  backupCodesRemaining,
}: TwoFactorVerificationProps): React.JSX.Element {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const handleChange = useCallback(
    (index: number, value: string): void => {
      if (!/^\d*$/.test(value)) return
      const digit = value.slice(-1)
      const newDigits = [...digits]
      newDigits[index] = digit
      setDigits(newDigits)

      // Auto-advance to next input
      if (digit && index < CODE_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus()
      }

      // Auto-submit when all 6 digits entered
      const code = newDigits.join('')
      if (code.length === CODE_LENGTH && !isSubmitting) {
        onSubmit(code).catch(() => undefined)
      }
    },
    [digits, isSubmitting, onSubmit],
  )

  const handleKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus()
      }
    },
    [digits],
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>): void => {
      e.preventDefault()
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
      if (!pasted) return
      const newDigits = Array(CODE_LENGTH).fill('')
      for (let i = 0; i < pasted.length; i++) {
        newDigits[i] = pasted[i]
      }
      setDigits(newDigits)

      if (pasted.length === CODE_LENGTH && !isSubmitting) {
        onSubmit(pasted).catch(() => undefined)
      }

      // Focus the next empty or last input
      const focusIdx = Math.min(pasted.length, CODE_LENGTH - 1)
      inputRefs.current[focusIdx]?.focus()
    },
    [isSubmitting, onSubmit],
  )

  const handleManualSubmit = useCallback((): void => {
    const code = digits.join('')
    if (code.length === CODE_LENGTH && !isSubmitting) {
      onSubmit(code).catch(() => undefined)
    }
  }, [digits, isSubmitting, onSubmit])

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm font-medium text-slate-700">Nhập mã xác thực</p>
        <p className="mt-1 text-xs text-slate-500">
          Nhập mã 6 chữ số từ ứng dụng xác thực của bạn
        </p>
      </div>

      {backupCodesRemaining !== undefined && backupCodesRemaining <= 3 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
          Còn {backupCodesRemaining} mã dự phòng. Hãy tạo mã mới trong phần cài đặt.
        </div>
      )}

      <div className="flex justify-center gap-2">
        {digits.map((digit, index) => (
          <Input
            key={index}
            ref={(el) => { inputRefs.current[index] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={index === 0 ? handlePaste : undefined}
            aria-label={`Digit ${index + 1}`}
            className="h-12 w-10 text-center text-lg font-semibold tabular-nums"
            disabled={isSubmitting}
            autoComplete="one-time-code"
          />
        ))}
      </div>

      {error && (
        <p className="text-center text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button
        type="button"
        className="w-full"
        onClick={handleManualSubmit}
        disabled={isSubmitting || digits.join('').length !== CODE_LENGTH}
      >
        {isSubmitting ? 'Đang xác thực...' : 'Xác thực'}
      </Button>
    </div>
  )
}
