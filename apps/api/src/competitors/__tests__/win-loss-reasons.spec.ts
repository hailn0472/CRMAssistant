import { WIN_LOSS_REASONS, isWinLossReason } from '../win-loss-reasons'
import type { WinLossReason } from '../win-loss-reasons'

describe('win-loss-reasons', () => {
  it('exposes the exact six-value readonly tuple (AC #6)', () => {
    expect(WIN_LOSS_REASONS).toEqual([
      'PRICE',
      'FEATURES',
      'TIMING',
      'COMPETITOR',
      'BUDGET',
      'OTHER',
    ])
  })

  it('types WinLossReason as the union of the tuple values', () => {
    const reason: WinLossReason = 'PRICE'
    expect(reason).toBe('PRICE')
    // Compile-time check: assigning an out-of-union value must fail — the
    // runtime guard below is what rejects it at the service boundary.
    expect(isWinLossReason('PRICE')).toBe(true)
  })

  it('isWinLossReason returns true for every valid reason', () => {
    for (const reason of WIN_LOSS_REASONS) {
      expect(isWinLossReason(reason)).toBe(true)
    }
  })

  it('isWinLossReason narrows the value to WinLossReason', () => {
    const value: string = 'FEATURES'
    if (isWinLossReason(value)) {
      const narrowed: WinLossReason = value
      expect(narrowed).toBe('FEATURES')
    } else {
      throw new Error('expected narrowing to succeed')
    }
  })

  it('isWinLossReason returns false for out-of-catalog values', () => {
    expect(isWinLossReason('INVALID')).toBe(false)
    expect(isWinLossReason('')).toBe(false)
    expect(isWinLossReason('price')).toBe(false) // case-sensitive
    expect(isWinLossReason('WON')).toBe(false)
  })
})
