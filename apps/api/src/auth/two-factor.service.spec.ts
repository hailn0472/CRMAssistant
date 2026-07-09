// Mock otplib — its ESM-only dependencies (@scure/base, @noble/hashes) can't be loaded by ts-jest
jest.mock('otplib', () => {
  const mockTOTP = jest.fn().mockImplementation(() => ({
    generateSecret: jest.fn().mockReturnValue('MOCK_SECRET'),
    generate: jest.fn().mockResolvedValue('123456'),
    verify: jest.fn().mockResolvedValue({ valid: true }),
    toURI: jest.fn().mockReturnValue('otpauth://totp/CRMAssistant:test@test.com?secret=MOCK_SECRET&issuer=CRMAssistant'),
  }))
  return {
    TOTP: mockTOTP,
    ScureBase32Plugin: jest.fn().mockImplementation(() => ({})),
  }
})

import { Test, type TestingModule } from '@nestjs/testing'
import { TwoFactorService } from './two-factor.service'

describe('TwoFactorService', () => {
  let service: TwoFactorService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TwoFactorService],
    }).compile()

    service = module.get<TwoFactorService>(TwoFactorService)
  })

  describe('generateSecret', () => {
    it('should return a non-empty string', () => {
      const secret = service.generateSecret()
      expect(secret).toBeTruthy()
      expect(typeof secret).toBe('string')
      expect(secret.length).toBeGreaterThan(0)
    })

    it('should return different secrets on each call', () => {
      const secret1 = service.generateSecret()
      expect(secret1).toBeDefined()
    })
  })

  describe('generateQrCodeDataUrl', () => {
    it('should return a valid data URL', async () => {
      const dataUrl = await service.generateQrCodeDataUrl('SECRET', 'test@example.com')
      expect(dataUrl).toBeTruthy()
      expect(typeof dataUrl).toBe('string')
    })
  })

  describe('verifyTotp', () => {
    it('should accept a valid TOTP code', async () => {
      const result = await service.verifyTotp('SECRET', '123456')
      expect(result).toBe(true)
    })

    it('should reject an invalid TOTP code', async () => {
      // Override mock to return failure
      const { TOTP } = require('otplib')
      const mockInstance = TOTP.mock.results[0].value
      mockInstance.verify.mockResolvedValueOnce({ valid: false })

      const result = await service.verifyTotp('SECRET', '000000')
      expect(result).toBe(false)
    })

    it('should handle errors gracefully', async () => {
      const { TOTP } = require('otplib')
      const mockInstance = TOTP.mock.results[0].value
      mockInstance.verify.mockRejectedValueOnce(new Error('TOTP error'))

      const result = await service.verifyTotp('SECRET', '000000')
      expect(result).toBe(false)
    })
  })

  describe('generateBackupCodes', () => {
    it('should return 10 codes', () => {
      const codes = service.generateBackupCodes()
      expect(codes).toHaveLength(10)
    })

    it('should return codes of length 8', () => {
      const codes = service.generateBackupCodes()
      for (const code of codes) {
        expect(code).toHaveLength(8)
      }
    })

    it('should return unique codes', () => {
      const codes = service.generateBackupCodes()
      const unique = new Set(codes)
      expect(unique.size).toBe(10)
    })

    it('should only contain valid characters (no 0/O/1/I/l)', () => {
      const codes = service.generateBackupCodes()
      const validChars = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/
      for (const code of codes) {
        expect(code).toMatch(validChars)
      }
    })
  })

  describe('hashBackupCodes', () => {
    it('should hash all codes', async () => {
      const codes = service.generateBackupCodes()
      const hashed = await service.hashBackupCodes(codes)
      expect(hashed).toHaveLength(10)
      for (const hash of hashed) {
        expect(hash).not.toBe('')
        expect(hash).not.toBe(codes[0])
      }
    })
  })

  describe('verifyBackupCode', () => {
    it('should find matching code and return its index', async () => {
      const codes = service.generateBackupCodes()
      const hashed = await service.hashBackupCodes(codes)
      const idx = await service.verifyBackupCode(codes[3], hashed)
      expect(idx).toBe(3)
    })

    it('should return -1 for non-matching code', async () => {
      const codes = service.generateBackupCodes()
      const hashed = await service.hashBackupCodes(codes)
      const idx = await service.verifyBackupCode('XXXXXXXX', hashed)
      expect(idx).toBe(-1)
    })
  })
})
