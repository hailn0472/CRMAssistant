import type { Metadata } from 'next'
import { Archivo, Newsreader } from 'next/font/google'

import { AppToaster } from '@/components/shared/AppToaster'

import './globals.css'

const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo' })
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader' })

export const metadata: Metadata = {
  title: 'CRMAssistant',
  description: 'AI-powered CRM platform for sales teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="vi">
      <body className={`${archivo.variable} ${newsreader.variable} font-sans`}>
        {children}
        <AppToaster />
      </body>
    </html>
  )
}
