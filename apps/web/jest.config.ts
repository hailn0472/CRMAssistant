import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  // Run setup file after Jest is installed in the environment
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Handle module name mapping (path aliases)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^lucide-react$':
      '<rootDir>/../../node_modules/.pnpm/lucide-react@0.474.0_react@18.3.1/node_modules/lucide-react/dist/cjs/lucide-react.js',
  },
  // Collect coverage from component and lib files; exclude page/layout/route files
  // Next.js App Router pages are server components — test them via E2E (Playwright), not unit tests
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{ts,tsx}',
    '!src/app/**/layout.tsx',
    '!src/app/**/page.tsx',
    '!src/app/**/loading.tsx',
    '!src/app/**/error.tsx',
    '!src/app/**/not-found.tsx',
    '!src/app/**/route.ts',
    '!src/app/globals.css',
    '!src/types/**',
    '!src/lib/supabase.ts',
    '!src/components/contacts/QueryProvider.tsx',
  ],
  // Coverage thresholds - minimum 80% unit coverage
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testMatch: ['**/__tests__/**/*.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}'],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
