import type { Config } from 'jest'

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['**/test/api/**/*.spec.ts'],
  transform: {
    // tsconfig.spec.json sets isolatedModules -> transpile-only, no per-worker TS program
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.d.ts',
    '!src/**/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.spec.ts',
  ],
  coverageDirectory: 'coverage-api',
  testEnvironment: 'node',
  testTimeout: 120_000,
  // The API harness boots a Postgres testcontainer per spec file — cap the fleet
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
}

export default config
