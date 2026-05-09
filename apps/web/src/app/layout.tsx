import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'CRMAssistant',
  description: 'AI-powered CRM platform for sales teams',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <html lang="vi">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
