/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac } from 'node:crypto'

import { UnauthorizedException } from '@nestjs/common'

import { FacebookWebhookController } from '../facebook-webhook.controller'

const APP_SECRET = 'super-secret-app-secret'
const VERIFY_TOKEN = 'my-verify-token'

function sign(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`
}

function makeReq(bodyObj: Record<string, unknown>, signature?: string): any {
  const raw = Buffer.from(JSON.stringify(bodyObj))
  return {
    headers: { 'x-hub-signature-256': signature },
    rawBody: raw,
    body: bodyObj,
  }
}

describe('FacebookWebhookController', () => {
  let controller: FacebookWebhookController
  let facebookService: { handleInboundMessagingEvent: jest.Mock }
  let configService: { get: jest.Mock }

  beforeEach(() => {
    facebookService = { handleInboundMessagingEvent: jest.fn().mockResolvedValue(undefined) }
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'FACEBOOK_APP_SECRET') return APP_SECRET
        if (key === 'FACEBOOK_VERIFY_TOKEN') return VERIFY_TOKEN
        return undefined
      }),
    }
    controller = new FacebookWebhookController(facebookService as any, configService as any)
  })

  describe('GET (verification handshake)', () => {
    it('echoes the challenge when mode and token match', () => {
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() }
      controller.verify('subscribe', VERIFY_TOKEN, 'challenge-123', res as any)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.send).toHaveBeenCalledWith('challenge-123')
    })

    it('returns 403 when the token does not match', () => {
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() }
      controller.verify('subscribe', 'wrong-token', 'challenge-123', res as any)

      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('returns 403 when mode is not subscribe', () => {
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() }
      controller.verify('unsubscribe', VERIFY_TOKEN, 'challenge-123', res as any)

      expect(res.status).toHaveBeenCalledWith(403)
    })
  })

  describe('POST (inbound events)', () => {
    it('rejects requests with a missing signature (401, no side effects)', async () => {
      const body = { object: 'page', entry: [] }
      const req = makeReq(body, undefined)

      await expect(controller.receive(req)).rejects.toThrow(UnauthorizedException)
      expect(facebookService.handleInboundMessagingEvent).not.toHaveBeenCalled()
    })

    it('rejects requests with an invalid signature (401, no side effects)', async () => {
      const body = { object: 'page', entry: [] }
      const req = makeReq(body, 'sha256=deadbeef')

      await expect(controller.receive(req)).rejects.toThrow(UnauthorizedException)
      expect(facebookService.handleInboundMessagingEvent).not.toHaveBeenCalled()
    })

    it('accepts a correctly-signed request and dispatches each messaging event', async () => {
      const body = {
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [{ sender: { id: 'psid-1' }, message: { text: 'hi' } }],
          },
        ],
      }
      const raw = Buffer.from(JSON.stringify(body))
      const req = { headers: { 'x-hub-signature-256': sign(raw.toString()) }, rawBody: raw, body }

      const result = await controller.receive(req as any)

      expect(result).toEqual({ received: true })
      expect(facebookService.handleInboundMessagingEvent).toHaveBeenCalledWith('page-1', {
        sender: { id: 'psid-1' },
        message: { text: 'hi' },
      })
    })

    it('ignores non-page objects without error', async () => {
      const body = { object: 'not-a-page' }
      const raw = Buffer.from(JSON.stringify(body))
      const req = { headers: { 'x-hub-signature-256': sign(raw.toString()) }, rawBody: raw, body }

      const result = await controller.receive(req as any)

      expect(result).toEqual({ received: true })
      expect(facebookService.handleInboundMessagingEvent).not.toHaveBeenCalled()
    })

    it('rejects when rawBody is unavailable', async () => {
      const body = { object: 'page' }
      const req = { headers: { 'x-hub-signature-256': sign('anything') }, rawBody: undefined, body }

      await expect(controller.receive(req as any)).rejects.toThrow(UnauthorizedException)
    })
  })
})
