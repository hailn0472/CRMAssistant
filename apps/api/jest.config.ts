import type { Config } from 'jest'

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // tsconfig.spec.json sets isolatedModules -> transpile-only, no per-worker TS program
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.d.ts',
    '!**/main.ts',
    '!**/*.module.ts',
    // Exclude infrastructure/config files and decorator/guard/DTO boilerplate covered via integration tests
    '!**/prisma.service.ts',
    '!**/dto/**',
    '!**/guards/**',
    '!**/decorators/**',
    '!**/strategies/**',
    '!**/inbox/**',
    '!**/*.graphql.ts',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // ts-jest builds a full TS program per worker; unbounded workers blow up RAM
  maxWorkers: '50%',
  workerIdleMemoryLimit: '512MB',
  // Mock ESM-only otplib so tests that import auth.service.ts don't break
  moduleNameMapper: {
    '^otplib$': '<rootDir>/auth/__mocks__/otplib.ts',
  },
  // Coverage thresholds - minimum 80% unit coverage
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
}

export default config
