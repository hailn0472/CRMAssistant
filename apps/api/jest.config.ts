import type { Config } from 'jest'

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
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
    '!**/*.graphql.ts',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
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
