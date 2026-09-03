'use strict'

const { createServer } = require('node:net')

const MIN_PORT = 1
const MAX_PORT = 65535
const DEFAULT_MAX_ATTEMPTS = 100

function parsePreferredPort(value, fallback) {
  if (value === undefined || value === '') return fallback

  const port = Number(value)
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`Invalid port "${value}". Expected an integer from ${MIN_PORT} to ${MAX_PORT}.`)
  }

  return port
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
    const finish = (available) => {
      server.removeAllListeners()
      resolve(available)
    }

    server.once('error', () => finish(false))
    server.once('listening', () => server.close(() => finish(true)))
    server.listen({ port, host: '::', exclusive: true })
  })
}

async function findAvailablePort(
  start,
  reservedPorts = new Set(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = start + offset
    if (port > MAX_PORT) break
    if (reservedPorts.has(port)) continue
    if (await isPortAvailable(port)) return port
  }

  throw new Error(
    `Could not find an available port between ${start} and ${start + maxAttempts - 1}.`,
  )
}

async function selectDevPorts({ apiStart = 4000, webStart = 3000 } = {}) {
  const apiPort = await findAvailablePort(apiStart)
  const webPort = await findAvailablePort(webStart, new Set([apiPort]))

  return { apiPort, webPort }
}

module.exports = { findAvailablePort, parsePreferredPort, selectDevPorts }
