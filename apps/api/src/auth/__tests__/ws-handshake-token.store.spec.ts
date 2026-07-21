import { consumeWsHandshakeToken, issueWsHandshakeToken } from '../ws-handshake-token.store'
import type { JwtPayload } from '../strategies/jwt.strategy'

const PAYLOAD: JwtPayload = {
  sub: 'user-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['SALES_REP'],
  email: 'user@example.com',
}

describe('ws-handshake-token.store', () => {
  it('issues a token that resolves back to the original payload exactly once', () => {
    const token = issueWsHandshakeToken(PAYLOAD)

    expect(consumeWsHandshakeToken(token)).toEqual(PAYLOAD)
    // Single-use — consuming again must fail even though it hasn't expired.
    expect(consumeWsHandshakeToken(token)).toBeNull()
  })

  it('returns null for an unknown token', () => {
    expect(consumeWsHandshakeToken('does-not-exist')).toBeNull()
  })

  it('returns null once the token has expired', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T00:00:00.000Z'))
    const token = issueWsHandshakeToken(PAYLOAD)

    jest.setSystemTime(new Date('2026-07-21T00:00:16.000Z')) // > 15s TTL

    expect(consumeWsHandshakeToken(token)).toBeNull()
    jest.useRealTimers()
  })

  it('issues unique tokens for successive calls', () => {
    const tokenA = issueWsHandshakeToken(PAYLOAD)
    const tokenB = issueWsHandshakeToken(PAYLOAD)

    expect(tokenA).not.toBe(tokenB)
  })
})
