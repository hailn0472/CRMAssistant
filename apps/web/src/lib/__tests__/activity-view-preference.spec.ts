/**
 * Stored view preference (Story 4.4, AC 35/45): round-trips, null on
 * absent/garbage, SSR guard, and no throw when localStorage throws.
 */

import {
  readStoredView,
  writeStoredView,
  isActivityView,
  ACTIVITY_VIEW_STORAGE_KEY,
  ACTIVITY_VIEWS,
} from '@/lib/activity-view-preference'

describe('activity-view-preference (Story 4.4, AC 35)', () => {
  const originalWindow = globalThis.window
  const originalLocalStorage = globalThis.localStorage

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    })
    jest.restoreAllMocks()
  })

  function mockWindowWith(storage: Storage | null): void {
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: storage ?? originalLocalStorage },
      configurable: true,
    })
    if (storage !== null) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: storage,
        configurable: true,
      })
    }
  }

  it('round-trips a stored view (AC 35)', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: jest.fn((k: string) => store.get(k) ?? null),
      setItem: jest.fn((k: string, v: string) => {
        store.set(k, v)
      }),
      removeItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(),
      get length() {
        return store.size
      },
    } as unknown as Storage
    mockWindowWith(storage)

    expect(readStoredView()).toBeNull()
    writeStoredView('calendar')
    expect(readStoredView()).toBe('calendar')
    expect(storage.setItem).toHaveBeenCalledWith(ACTIVITY_VIEW_STORAGE_KEY, 'calendar')
  })

  it('returns null when the key is absent', () => {
    const storage = {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(),
      length: 0,
    } as unknown as Storage
    mockWindowWith(storage)

    expect(readStoredView()).toBeNull()
  })

  it('returns null for a garbage stored value', () => {
    const storage = {
      getItem: jest.fn(() => 'banana'),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(),
      length: 0,
    } as unknown as Storage
    mockWindowWith(storage)

    expect(readStoredView()).toBeNull()
  })

  it('returns null when window is undefined (SSR guard)', () => {
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
    })

    expect(readStoredView()).toBeNull()
    // Write is a no-op, not a crash.
    expect(() => writeStoredView('timeline')).not.toThrow()
  })

  it('does not throw when localStorage throws (private-browsing SecurityError)', () => {
    const throwingStorage = {
      getItem: jest.fn(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      }),
      setItem: jest.fn(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      }),
      removeItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(),
      length: 0,
    } as unknown as Storage
    mockWindowWith(throwingStorage)

    expect(() => readStoredView()).not.toThrow()
    expect(readStoredView()).toBeNull()
    expect(() => writeStoredView('list')).not.toThrow()
  })

  it('treats only the three known views as valid', () => {
    expect(ACTIVITY_VIEWS).toEqual(['list', 'calendar', 'timeline'])
    for (const view of ACTIVITY_VIEWS) {
      expect(isActivityView(view)).toBe(true)
    }
    expect(isActivityView('table')).toBe(false)
    expect(isActivityView(42)).toBe(false)
    expect(isActivityView(null)).toBe(false)
    expect(isActivityView(undefined)).toBe(false)
  })
})
