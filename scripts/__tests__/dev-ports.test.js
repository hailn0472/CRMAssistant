'use strict'

const assert = require('node:assert/strict')
const { createServer } = require('node:net')
const test = require('node:test')

const { findAvailablePort, selectDevPorts } = require('../dev-ports')

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
}

function close(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

test('findAvailablePort skips an occupied preferred port', async () => {
  const occupied = createServer()
  await listen(occupied, 0)

  try {
    const address = occupied.address()
    assert.ok(address && typeof address === 'object')

    const port = await findAvailablePort(address.port)
    assert.notEqual(port, address.port)
  } finally {
    await close(occupied)
  }
})

test('selectDevPorts assigns distinct ports when API and web share a preferred port', async () => {
  const ports = await selectDevPorts({ apiStart: 4100, webStart: 4100 })

  assert.notEqual(ports.apiPort, ports.webPort)
  assert.ok(ports.apiPort >= 4100)
  assert.ok(ports.webPort >= 4100)
})
