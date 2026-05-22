import type { Config } from 'jest'

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['**/test/api/**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
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
}

export default config
