import type { Metadata } from 'next'

import { AppToaster } from '@/components/shared/AppToaster'

import './globals.css'

export const metadata: Metadata = {
  title: 'CRMAssistant',
  description: 'AI-powered CRM platform for sales teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="vi">
      <body className="font-sans">
        {children}
        <AppToaster />
      </body>
    </html>
  )
}
