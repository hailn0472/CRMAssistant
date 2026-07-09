import '@testing-library/jest-dom'

import { webcrypto } from 'crypto'

// jsdom does not implement Web Crypto, which is used by middleware JWT verification.
// Node.js provides a webcrypto implementation that we can expose in jsdom tests.
if (typeof global.crypto === 'undefined' || typeof global.crypto.subtle === 'undefined') {
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  })
}

// jsdom does not implement ResizeObserver, which is used by cmdk (via
// @radix-ui/react-dialog). Provide a minimal stub so tests don't crash.
global.ResizeObserver = class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// jsdom does not implement scrollIntoView, which is used by cmdk during
// keyboard navigation of command items. Provide a minimal stub.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = jest.fn()
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: jest.fn().mockResolvedValue({ data: {}, error: null }),
      exchangeCodeForSession: jest.fn(),
    },
  },
}))
