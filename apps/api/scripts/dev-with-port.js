#!/usr/bin/env node
'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')

const { findAvailablePort, parsePreferredPort } = require('../../../scripts/dev-ports')

const API_ROOT = path.resolve(__dirname, '..')
const Nest = process.platform === 'win32' ? 'nest.cmd' : 'nest'
let child = null

async function main() {
  const preferredPort = parsePreferredPort(process.env.DEV_API_PORT ?? process.env.PORT, 4000)
  const port = await findAvailablePort(preferredPort)

  if (port !== preferredPort) {
    console.log(
      `[api:dev] Port ${preferredPort} is in use; using http://localhost:${port} instead.`,
    )
  }

  child = spawn(Nest, ['start', '--watch'], {
    cwd: API_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: 'inherit',
  })
  child.on('exit', (code) => {
    child = null
    process.exitCode = code ?? 0
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child) child.kill(signal)
  })
}

main().catch((error) => {
  console.error(`[api:dev] ${error.message}`)
  process.exitCode = 1
})
