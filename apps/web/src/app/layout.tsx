import type { Metadata } from 'next'
import { Inter_Tight, IBM_Plex_Mono } from 'next/font/google'

import { AppToaster } from '@/components/shared/AppToaster'

import './globals.css'

// Matches the design system: Inter Tight for UI text, IBM Plex Mono for
// monospaced values (CSV column names, IDs, amounts).
const interTight = Inter_Tight({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'CRMAssistant',
  description: 'AI-powered CRM platform for sales teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="vi" className={`${interTight.variable} ${ibmPlexMono.variable}`}>
      <body className="font-sans antialiased">
        {children}
        <AppToaster />
      </body>
    </html>
  )
}
