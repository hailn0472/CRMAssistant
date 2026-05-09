import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workspaces = ['apps/web', 'apps/api']
const missing = workspaces.filter((workspace) => {
  const packageJson = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
  return typeof packageJson.scripts?.test !== 'string'
})

if (missing.length > 0) {
  console.warn(`⚠️  Missing test scripts in workspaces: ${missing.join(', ')}`)
  console.warn('Add real test scripts in Story 1.5 before enabling the pre-push test gate.')
  console.warn('Skipping test execution for now...')
  process.exit(0)
}
