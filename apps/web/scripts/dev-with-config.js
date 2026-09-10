#!/usr/bin/env node
'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')

const WEB_ROOT = path.resolve(__dirname, '..')
const routeWatcher = path.join(__dirname, 'dev-with-route-watch.js')
const env = { ...process.env }

if (process.env.DEV_WEB_PORT) env.PORT = process.env.DEV_WEB_PORT
if (process.env.DEV_API_URL) env.NEXT_PUBLIC_API_URL = process.env.DEV_API_URL

const child = spawn(process.execPath, [routeWatcher], {
  cwd: WEB_ROOT,
  env,
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code) => {
  process.exitCode = code ?? 0
})
