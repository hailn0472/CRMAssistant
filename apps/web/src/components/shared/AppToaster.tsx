'use client'

import { Toaster } from 'react-hot-toast'

export function AppToaster(): React.JSX.Element {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          border: '1px solid rgb(226 232 240)',
          borderRadius: '12px',
          boxShadow: '0 10px 25px -12px rgb(15 23 42 / 0.35)',
          color: 'rgb(15 23 42)',
          fontSize: '14px',
          maxWidth: '360px',
        },
        success: {
          iconTheme: {
            primary: 'rgb(5 150 105)',
            secondary: 'rgb(236 253 245)',
          },
        },
        error: {
          iconTheme: {
            primary: 'rgb(220 38 38)',
            secondary: 'rgb(254 242 242)',
          },
        },
      }}
    />
  )
}
