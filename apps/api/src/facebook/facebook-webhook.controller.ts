import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'

import { FacebookService } from './facebook.service'
import type { FacebookWebhookBody } from './facebook-message.types'

/**
 * Public REST endpoint for Facebook Messenger webhooks. Public (no
 * `JwtAuthGuard`) because Facebook calls it unauthenticated — the
 * `X-Hub-Signature-256` HMAC check is the auth mechanism for POST events.
 *
 * Does NOT bind a strict class-validator DTO to `@Body()`: the global
 * `ValidationPipe({ forbidNonWhitelisted: true })` would strip/reject
 * Facebook's payload shape. The body is read as a loose type and validated
 * defensively field-by-field instead.
 */
@Controller('webhooks/facebook')
export class FacebookWebhookController {
  constructor(
    private readonly facebookService: FacebookService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyTokenParam: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const expectedToken = this.configService.get<string>('FACEBOOK_VERIFY_TOKEN')

    if (mode === 'subscribe' && expectedToken && verifyTokenParam === expectedToken) {
      res.status(HttpStatus.OK).send(challenge ?? '')
      return
    }

    res.status(HttpStatus.FORBIDDEN).send('Verification failed')
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<{ received: boolean }> {
    const appSecret = this.configService.get<string>('FACEBOOK_APP_SECRET')
    const signatureHeader = req.headers['x-hub-signature-256']

    if (!this.isValidSignature(req.rawBody, signatureHeader, appSecret)) {
      throw new UnauthorizedException('Invalid webhook signature')
    }

    const body = req.body as FacebookWebhookBody
    if (body?.object !== 'page') {
      return { received: true }
    }

    for (const entry of body.entry ?? []) {
      const pageId = entry.id
      if (!pageId) continue

      for (const event of entry.messaging ?? []) {
        try {
          // Sequential per event to avoid interleaved conversation/message writes.
          // eslint-disable-next-line no-await-in-loop
          await this.facebookService.handleInboundMessagingEvent(pageId, event)
        } catch (error) {
          // Never let one bad/edge-case event (e.g. a tenant with no active
          // users to own an auto-created contact) turn into a non-200
          // response — Facebook would then retry the whole batch forever.
          // eslint-disable-next-line no-console
          console.error('[FacebookWebhookController] Failed to process inbound event', error)
        }
      }
    }

    return { received: true }
  }

  private isValidSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | string[] | undefined,
    appSecret: string | undefined,
  ): boolean {
    if (!rawBody || !appSecret || typeof signatureHeader !== 'string') return false

    const [algorithm, providedSignature] = signatureHeader.split('=')
    if (algorithm !== 'sha256' || !providedSignature) return false

    const expectedSignature = createHmac('sha256', appSecret).update(rawBody).digest('hex')

    let expectedBuffer: Buffer
    let providedBuffer: Buffer
    try {
      expectedBuffer = Buffer.from(expectedSignature, 'hex')
      providedBuffer = Buffer.from(providedSignature, 'hex')
    } catch {
      return false
    }

    if (expectedBuffer.length !== providedBuffer.length) return false

    return timingSafeEqual(expectedBuffer, providedBuffer)
  }
}
