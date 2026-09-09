import {
  Controller,
  Get,
  Inject,
  Req,
  Res,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import type { Registry } from 'prom-client'

import {
  METRICS_OPTIONS,
  METRICS_REGISTRY,
  type MetricsRegistry,
  type ObservabilityOptions,
} from './metrics.types'

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  const length = Math.max(leftBuffer.length, rightBuffer.length)
  const paddedLeft = Buffer.alloc(length)
  const paddedRight = Buffer.alloc(length)

  leftBuffer.copy(paddedLeft)
  rightBuffer.copy(paddedRight)

  return timingSafeEqual(paddedLeft, paddedRight) && leftBuffer.length === rightBuffer.length
}

function getBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  return match?.[1]?.trim() || undefined
}

@Controller()
export class MetricsController {
  constructor(
    @Inject(METRICS_OPTIONS) private readonly options: ObservabilityOptions,
    @Inject(METRICS_REGISTRY) private readonly registry: MetricsRegistry,
  ) {}

  @Get('metrics')
  async metrics(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    if (!this.options.enabled) {
      throw new NotFoundException()
    }

    const requestAuthorization = request.headers.authorization
    const suppliedToken = getBearerToken(requestAuthorization)
    if (
      !suppliedToken ||
      !this.options.scrapeToken ||
      !constantTimeEqual(suppliedToken, this.options.scrapeToken)
    ) {
      throw new UnauthorizedException('Invalid metrics credentials')
    }

    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', (this.registry as Registry).contentType)
    return this.registry.metrics()
  }
}
