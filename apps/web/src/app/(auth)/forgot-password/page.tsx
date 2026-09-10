'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { authService } from '@/services/auth.service'

const forgotPasswordSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
})

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>

function ForgotPasswordForm(): React.JSX.Element {
  const [isSubmitted, setIsSubmitted] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  const onSubmit = async (data: ForgotPasswordFormData): Promise<void> => {
    try {
      await authService.forgotPassword(data.email)
      setIsSubmitted(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể gửi hướng dẫn lúc này'
      setError('root', { message })
    }
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
            Khôi phục mật khẩu
          </CardTitle>
          <CardDescription className="text-slate-600">
            Nhập email tài khoản để nhận hướng dẫn đặt lại mật khẩu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSubmitted ? (
            <div className="space-y-5">
              <div
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
                role="status"
              >
                Nếu email này tồn tại trong hệ thống, hướng dẫn khôi phục mật khẩu sẽ được gửi trong
                vài phút.
              </div>
              <Button asChild className="w-full bg-blue-600 text-white hover:bg-blue-700">
                <Link href="/login">Quay lại đăng nhập</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-800" htmlFor="forgot-email">
                  Email
                </label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="ban@example.com"
                  autoComplete="email"
                  aria-describedby={errors.email ? 'forgot-email-error' : undefined}
                  aria-invalid={errors.email ? 'true' : 'false'}
                  {...register('email')}
                />
                {errors.email && (
                  <p id="forgot-email-error" className="text-sm text-destructive" role="alert">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {errors.root && (
                <div
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-blue-600 text-white hover:bg-blue-700"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Đang gửi hướng dẫn...' : 'Gửi hướng dẫn khôi phục'}
              </Button>
            </form>
          )}

          <div className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-600">
            <Link href="/login" className="font-medium text-blue-700 hover:underline">
              Đăng nhập
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/register" className="font-medium text-blue-700 hover:underline">
              Đăng ký
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

export default function ForgotPasswordPage(): React.JSX.Element {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  )
}
