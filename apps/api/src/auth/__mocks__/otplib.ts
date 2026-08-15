// Jest mock for otplib — ESM-only @scure/base and @noble/hashes can't be loaded by ts-jest
// Only the module-level API surface used by TwoFactorService needs to be mocked.
export const ScureBase32Plugin = jest.fn().mockImplementation(() => ({}))

const mockTOTP = {
  generateSecret: jest.fn().mockReturnValue('MOCK_SECRET'),
  generate: jest.fn().mockResolvedValue('123456'),
  verify: jest.fn().mockResolvedValue({ valid: true }),
  toURI: jest
    .fn()
    .mockReturnValue(
      'otpauth://totp/CRMAssistant:test@test.com?secret=MOCK_SECRET&issuer=CRMAssistant',
    ),
}

export const TOTP = jest.fn().mockImplementation(() => mockTOTP)
