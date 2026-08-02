import {
  DEFAULT_EMAIL_FREQUENCY,
  EMAIL_FREQUENCIES,
  isEmailFrequency,
} from '../reminder-preference-values'

describe('reminder-preference-values', () => {
  it('exports exactly DAILY, WEEKLY, OFF with DAILY as the default', () => {
    expect(EMAIL_FREQUENCIES).toEqual(['DAILY', 'WEEKLY', 'OFF'])
    expect(DEFAULT_EMAIL_FREQUENCY).toBe('DAILY')
  })

  it('accepts each valid frequency', () => {
    for (const frequency of EMAIL_FREQUENCIES) {
      expect(isEmailFrequency(frequency)).toBe(true)
    }
  })

  it('rejects anything outside the vocabulary (AC 15)', () => {
    expect(isEmailFrequency('HOURLY')).toBe(false)
    expect(isEmailFrequency('MONTHLY')).toBe(false)
    expect(isEmailFrequency('daily')).toBe(false)
    expect(isEmailFrequency('')).toBe(false)
  })
})
