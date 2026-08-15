import { Injectable } from '@nestjs/common'
import { TOTP, ScureBase32Plugin } from 'otplib'
import * as QRCode from 'qrcode'
import * as bcrypt from 'bcryptjs'
import * as nodeCrypto from 'crypto'

const BACKUP_CODE_LENGTH = 8
const BACKUP_CODE_COUNT = 10
const TOTP_ISSUER = 'CRMAssistant'

// Build otplib v13-compatible crypto plugin from Node's built-in crypto module
const cryptoPlugin = {
  name: 'node:crypto' as const,
  hmac(algo: string, key: Uint8Array, data: Uint8Array): Uint8Array {
    const h = nodeCrypto.createHmac(algo, key)
    h.update(data)
    return new Uint8Array(h.digest())
  },
  randomBytes(size: number): Uint8Array {
    return new Uint8Array(nodeCrypto.randomBytes(size))
  },
  constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    let result = 0
    for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i]
    return result === 0
  },
}

const base32 = new ScureBase32Plugin()
const totp = new TOTP({ crypto: cryptoPlugin, base32 })

@Injectable()
export class TwoFactorService {
  generateSecret(): string {
    return totp.generateSecret()
  }

  async generateQrCodeDataUrl(secret: string, email: string): Promise<string> {
    const otpauth = totp.toURI({ label: email, issuer: TOTP_ISSUER, secret })
    return QRCode.toDataURL(otpauth)
  }

  async verifyTotp(secret: string, code: string): Promise<boolean> {
    try {
      // otplib v13 verify accepts { token, secret } at runtime despite TS types
      type VerifyResult = { valid: boolean }
      type VerifyFn = (opts: {
        token: string
        secret: string
      }) => VerifyResult | Promise<VerifyResult>
      const result = await (totp.verify as unknown as VerifyFn)({ token: code, secret })
      return result.valid === true
    } catch {
      return false
    }
  }

  generateBackupCodes(): string[] {
    const codes: string[] = []
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      codes.push(this.generateBackupCode())
    }
    return codes
  }

  async hashBackupCodes(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((code) => bcrypt.hash(code, 10)))
  }

  async verifyBackupCode(code: string, hashedCodes: string[]): Promise<number> {
    for (let i = 0; i < hashedCodes.length; i++) {
      if (await bcrypt.compare(code, hashedCodes[i])) {
        return i
      }
    }
    return -1
  }

  private generateBackupCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
      code += chars[nodeCrypto.randomInt(chars.length)]
    }
    return code
  }
}
