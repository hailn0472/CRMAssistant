export const BACKEND_AUTH_COOKIE = 'backend-auth-token'
export const WEB_SESSION_COOKIE = 'web-auth-session'
export const ONE_DAY_SECONDS = 86_400

const MIN_SECRET_LENGTH = 32

type WebSessionPayload = {
  authenticated: true
  exp: number
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function getWebSessionSecret(): string | undefined {
  const secret = process.env['WEB_SESSION_SECRET']
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return undefined
  }
  return secret
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function createWebSessionCookieValue(expiresAtSeconds: number): Promise<string> {
  const secret = getWebSessionSecret()
  if (!secret) {
    throw new Error('WEB_SESSION_SECRET must be at least 32 characters long')
  }

  const payload: WebSessionPayload = {
    authenticated: true,
    exp: expiresAtSeconds,
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const key = await importSigningKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload))
  let binarySignature = ''
  new Uint8Array(signature).forEach((byte) => {
    binarySignature += String.fromCharCode(byte)
  })
  const encodedSignature = btoa(binarySignature)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return `${encodedPayload}.${encodedSignature}`
}

export async function verifyWebSessionCookieValue(value: string): Promise<boolean> {
  const secret = getWebSessionSecret()
  if (!secret) return false

  const parts = value.split('.')
  if (parts.length !== 2) return false

  const [encodedPayload, encodedSignature] = parts
  const key = await importSigningKey(secret)
  const isSignatureValid = await crypto.subtle.verify(
    'HMAC',
    key,
    bytesToArrayBuffer(base64UrlToBytes(encodedSignature)),
    new TextEncoder().encode(encodedPayload),
  )

  if (!isSignatureValid) return false

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encodedPayload)),
    ) as Partial<WebSessionPayload>
    const nowSeconds = Math.floor(Date.now() / 1000)
    return (
      payload.authenticated === true && typeof payload.exp === 'number' && payload.exp > nowSeconds
    )
  } catch {
    return false
  }
}
