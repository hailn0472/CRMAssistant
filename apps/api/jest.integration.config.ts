import type { Config } from 'jest'

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['**/test/integration/**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.d.ts',
    '!src/**/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.spec.ts',
    '!src/tags/**', // Tested via unit tests; excluded from integration coverage
    '!src/segments/**', // Tested via unit tests; excluded from integration coverage
    '!src/common/decorators/**', // Decorators tested via unit tests; excluded from integration coverage
    '!src/inbox/**', // Tested via unit tests; excluded from integration coverage
    '!src/facebook/**', // Tested via unit tests; no dedicated integration spec yet (Story 8A.3 AC #15, deferred)
    '!src/common/crypto/**', // Tested via unit tests; only consumed by facebook/ so far
    '!src/auth/ws-handshake-token.store.ts', // Tested via unit tests; no dedicated integration spec yet
  ],
  coverageDirectory: 'coverage-integration',
  testEnvironment: 'node',
  // Integration tests may take longer due to container startup
  testTimeout: 60000,
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
}

export default config
