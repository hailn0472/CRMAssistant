'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'

const registerSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự'),
  name: z.string().min(2, 'Tên phải có ít nhất 2 ký tự'),
  tenantName: z.string().min(2, 'Tên công ty phải có ít nhất 2 ký tự'),
})

type RegisterFormData = z.infer<typeof registerSchema>

function RegisterForm(): React.JSX.Element {
  const { register: registerUser } = useAuth()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  const onSubmit = async (data: RegisterFormData): Promise<void> => {
    try {
      await registerUser(data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Đăng ký thất bại'
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
            Đăng ký
          </CardTitle>
          <CardDescription className="text-slate-600">
            Tạo tài khoản mới để bắt đầu sử dụng CRMAssistant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-800" htmlFor="name">
                Họ và tên
              </label>
              <Input
                id="name"
                type="text"
                placeholder="Nguyễn Văn A"
                autoComplete="name"
                aria-describedby={errors.name ? 'register-name-error' : undefined}
                aria-invalid={errors.name ? 'true' : 'false'}
                {...register('name')}
              />
              {errors.name && (
                <p id="register-name-error" className="text-sm text-destructive" role="alert">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-800" htmlFor="tenantName">
                Tên công ty
              </label>
              <Input
                id="tenantName"
                type="text"
                placeholder="Công ty ACME"
                aria-describedby={errors.tenantName ? 'register-tenant-name-error' : undefined}
                aria-invalid={errors.tenantName ? 'true' : 'false'}
                {...register('tenantName')}
              />
              {errors.tenantName && (
                <p
                  id="register-tenant-name-error"
                  className="text-sm text-destructive"
                  role="alert"
                >
                  {errors.tenantName.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-800" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="ban@example.com"
                autoComplete="email"
                aria-describedby={errors.email ? 'register-email-error' : undefined}
                aria-invalid={errors.email ? 'true' : 'false'}
                {...register('email')}
              />
              {errors.email && (
                <p id="register-email-error" className="text-sm text-destructive" role="alert">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-800" htmlFor="password">
                Mật khẩu
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                aria-describedby={
                  errors.password ? 'register-password-error' : 'register-password-help'
                }
                aria-invalid={errors.password ? 'true' : 'false'}
                {...register('password')}
              />
              {errors.password ? (
                <p id="register-password-error" className="text-sm text-destructive" role="alert">
                  {errors.password.message}
                </p>
              ) : (
                <p id="register-password-help" className="text-sm text-slate-500">
                  Mật khẩu cần có ít nhất 8 ký tự.
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
              {isSubmitting ? 'Đang đăng ký...' : 'Đăng ký'}
            </Button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-600">
            Đã có tài khoản?{' '}
            <Link href="/login" className="font-medium text-blue-700 hover:underline">
              Đăng nhập
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

export default function RegisterPage(): React.JSX.Element {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}
