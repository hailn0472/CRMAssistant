#!/usr/bin/env node
'use strict'

// Next 14's App Router dev server hot-reloads edits to an EXISTING page just
// fine, but it doesn't reliably re-scan its route manifest when a route file
// (page.tsx, layout.tsx, route.ts, ...) is added or removed while the server
// is running — a known Next.js limitation, not a bug in this project. That's
// what causes the "404 / Module not found until I kill and restart" symptom.
//
// This wrapper watches src/app for exactly those additions/removals and
// restarts `next dev` automatically, so a manual restart is never needed.

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const APP_DIR = path.join(__dirname, '..', 'src', 'app')
const WEB_ROOT = path.join(__dirname, '..')

// Files whose mere existence defines a route segment for the App Router.
const ROUTE_FILENAMES = new Set([
  'page.tsx',
  'page.ts',
  'page.jsx',
  'page.js',
  'layout.tsx',
  'layout.ts',
  'layout.jsx',
  'layout.js',
  'route.ts',
  'route.js',
  'template.tsx',
  'template.ts',
  'loading.tsx',
  'loading.ts',
  'error.tsx',
  'error.ts',
  'not-found.tsx',
  'not-found.ts',
  'default.tsx',
  'default.ts',
])

const DEBOUNCE_MS = 300

let child = null
let restarting = false
let restartTimer = null

function startNext() {
  child = spawn(process.platform === 'win32' ? 'next.cmd' : 'next', ['dev'], {
    stdio: 'inherit',
    env: process.env,
    cwd: WEB_ROOT,
  })
  child.on('exit', (code) => {
    child = null
    if (!restarting) process.exit(code ?? 0)
  })
}

function scheduleRestart(relativePath) {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    console.log(`\n[dev-watch] Route file changed (${relativePath}) — restarting next dev...\n`)
    restarting = true
    if (child) {
      child.once('exit', () => {
        restarting = false
        startNext()
      })
      child.kill('SIGTERM')
    } else {
      restarting = false
      startNext()
    }
  }, DEBOUNCE_MS)
}

fs.watch(APP_DIR, { recursive: true }, (eventType, filename) => {
  // 'rename' fires for both create and delete — exactly the structural
  // changes that need a restart. Plain content edits ('change') already
  // hot-reload correctly and are left alone here.
  if (eventType !== 'rename' || !filename) return
  if (ROUTE_FILENAMES.has(path.basename(filename))) {
    scheduleRestart(filename)
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child) child.kill(signal)
    process.exit(0)
  })
}

startNext()
