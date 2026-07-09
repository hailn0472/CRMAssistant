'use client'

import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'

interface BackupCodesDisplayProps {
  codes: string[]
  onConfirmed?: () => void
}

export function BackupCodesDisplay({ codes, onConfirmed }: BackupCodesDisplayProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may not be available
    }
  }, [codes])

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-800">Lưu các mã dự phòng này</p>
        <p className="mt-1 text-xs text-amber-700">
          Mỗi mã chỉ sử dụng được một lần. Hãy lưu chúng ở nơi an toàn. Nếu mất thiết bị xác thực,
          bạn có thể dùng các mã này để đăng nhập.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {codes.map((code, index) => (
          <div
            key={index}
            className="rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700"
          >
            {code}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={handleCopy}>
          {copied ? 'Đã sao chép!' : 'Sao chép tất cả'}
        </Button>
        {onConfirmed && (
          <Button type="button" className="flex-1" onClick={onConfirmed}>
            Tôi đã lưu các mã này
          </Button>
        )}
      </div>
    </div>
  )
}
