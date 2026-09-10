import { randomBytes } from 'node:crypto'

import { decryptToken, encryptToken, loadEncryptionKey } from '../token-crypto'

const VALID_HEX_KEY = randomBytes(32).toString('hex')
const VALID_BASE64_KEY = randomBytes(32).toString('base64')

describe('token-crypto', () => {
  const originalKey = process.env['ENCRYPTION_KEY']

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env['ENCRYPTION_KEY']
    } else {
      process.env['ENCRYPTION_KEY'] = originalKey
    }
  })

  describe('loadEncryptionKey()', () => {
    it('throws when ENCRYPTION_KEY is missing', () => {
      delete process.env['ENCRYPTION_KEY']
      expect(() => loadEncryptionKey()).toThrow('ENCRYPTION_KEY environment variable is required')
    })

    it('throws when the key does not decode to 32 bytes', () => {
      process.env['ENCRYPTION_KEY'] = Buffer.from('too-short').toString('base64')
      expect(() => loadEncryptionKey()).toThrow(/must decode to exactly 32 bytes/)
    })

    it('accepts a 64-char hex key', () => {
      process.env['ENCRYPTION_KEY'] = VALID_HEX_KEY
      expect(loadEncryptionKey()).toHaveLength(32)
    })

    it('accepts a base64-encoded 32-byte key', () => {
      process.env['ENCRYPTION_KEY'] = VALID_BASE64_KEY
      expect(loadEncryptionKey()).toHaveLength(32)
    })
  })

  describe('encryptToken() / decryptToken() round-trip', () => {
    beforeEach(() => {
      process.env['ENCRYPTION_KEY'] = VALID_HEX_KEY
    })

    it('round-trips a plaintext token', () => {
      const plaintext = 'EAAG-example-facebook-page-access-token'
      const encrypted = encryptToken(plaintext)

      expect(encrypted).not.toContain(plaintext)
      expect(decryptToken(encrypted)).toBe(plaintext)
    })

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const plaintext = 'same-plaintext'
      const first = encryptToken(plaintext)
      const second = encryptToken(plaintext)

      expect(first).not.toBe(second)
      expect(decryptToken(first)).toBe(plaintext)
      expect(decryptToken(second)).toBe(plaintext)
    })

    it('throws when ciphertext has been tampered with', () => {
      const encrypted = encryptToken('sensitive-value')
      const tampered = Buffer.from(encrypted, 'base64')
      tampered[tampered.length - 1] ^= 0xff

      expect(() => decryptToken(tampered.toString('base64'))).toThrow()
    })

    it('throws when decrypting with a different key', () => {
      const encrypted = encryptToken('sensitive-value')
      process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')

      expect(() => decryptToken(encrypted)).toThrow()
    })

    it('throws on a too-short payload', () => {
      expect(() => decryptToken(Buffer.from('short').toString('base64'))).toThrow(
        'Invalid encrypted token payload',
      )
    })
  })
})
