#!/usr/bin/env node
'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')

const { parsePreferredPort, selectDevPorts } = require('./dev-ports')

const ROOT = path.resolve(__dirname, '..')
const Pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
let shuttingDown = false
const children = []

function stopChildren(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}

function startWorkspace(name, env) {
  const child = spawn(Pnpm, ['--filter', name, 'run', 'dev'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  })
  children.push(child)

  child.on('exit', (code, signal) => {
    if (shuttingDown) return

    shuttingDown = true
    stopChildren('SIGTERM')
    process.exitCode = code ?? (signal ? 1 : 0)
  })
}

async function main() {
  const apiStart = parsePreferredPort(process.env.API_PORT, 4000)
  const webStart = parsePreferredPort(process.env.WEB_PORT, 3000)
  const { apiPort, webPort } = await selectDevPorts({ apiStart, webStart })
  const apiUrl = `http://localhost:${apiPort}`

  console.log(`[dev] API: ${apiUrl}; web: http://localhost:${webPort}`)

  startWorkspace('api', {
    ...process.env,
    DEV_API_PORT: String(apiPort),
  })
  startWorkspace('web', {
    ...process.env,
    DEV_WEB_PORT: String(webPort),
    DEV_API_URL: apiUrl,
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true
    stopChildren(signal)
  })
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`)
  process.exitCode = 1
})
