import type { Config } from 'jest'

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // Integration specs are kept close to the production module they exercise
  // (`src/**/__tests__/*.integration.spec.ts`) as well as in the legacy
  // package-level integration directory. Keep both locations discoverable so
  // adding a spec does not require moving production or test files.
  testMatch: [
    '<rootDir>/test/integration/**/*.spec.ts',
    '<rootDir>/src/**/__tests__/**/*.integration.spec.ts',
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: {
    // tsconfig.spec.json sets isolatedModules -> transpile-only, no per-worker TS program
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  collectCoverageFrom: [
    // The retained integration suite exercises the Inbox boundary. Keep this
    // report scoped to that boundary; the unit suite enforces whole-API coverage.
    'src/inbox/**/*.(t|j)s',
    '!src/**/*.d.ts',
    '!src/**/*.module.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.graphql.ts',
  ],
  coverageDirectory: 'coverage-integration',
  testEnvironment: 'node',
  // Integration tests may take longer due to container startup
  testTimeout: 60000,
  // Each spec file boots its own Postgres testcontainer + `prisma migrate deploy`
  // + a full Nest app (~1.5GB peak). Jest's default (cores - 1) workers would run
  // ~11 of those at once and exhaust RAM into swap. Keep the fleet small.
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
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
