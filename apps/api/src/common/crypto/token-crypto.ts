import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM: 256-bit key, 96-bit IV (NIST recommended for GCM), 128-bit auth tag.
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

/**
 * Loads and validates the AES-256-GCM key from `ENCRYPTION_KEY`.
 * Accepts a 64-char hex string or a base64 string that decodes to exactly 32 bytes.
 * Throws a clear error if the key is missing or the wrong length — call this
 * eagerly (e.g. in a module's onModuleInit) so misconfiguration fails at startup
 * rather than on the first token operation.
 */
export function loadEncryptionKey(): Buffer {
  const raw = process.env['ENCRYPTION_KEY']
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required (32-byte key, hex or base64 encoded)',
    )
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (got ${key.length}) — provide a 64-char hex string or base64-encoded 32-byte key`,
    )
  }

  return key
}

/**
 * Encrypts plaintext with AES-256-GCM. Output format: base64(iv | authTag | ciphertext).
 * Generic on purpose — reusable for any secret needing encryption at rest
 * (Facebook page tokens now, other channel tokens in future 8B stories).
 */
export function encryptToken(plaintext: string): string {
  const key = loadEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

/**
 * Decrypts a value produced by `encryptToken`. Throws if the auth tag does not
 * verify (tampered/corrupted ciphertext or wrong key).
 */
export function decryptToken(encoded: string): string {
  const key = loadEncryptionKey()
  const buf = Buffer.from(encoded, 'base64')

  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted token payload')
  }

  const iv = buf.subarray(0, IV_LENGTH)
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return plaintext.toString('utf8')
}
