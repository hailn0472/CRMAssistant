import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  // `rawBody: true` preserves the raw request Buffer on `req.rawBody` so the
  // Facebook webhook controller can verify `X-Hub-Signature-256` against the
  // exact bytes Facebook signed (JSON.stringify(req.body) would not match).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })
  const configService = app.get(ConfigService)
  const port = configService.get<number>('PORT') ?? 4000

  // Global validation pipe — strips unknown properties and transforms payloads
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  // CORS — allow frontend origin
  const frontendUrl = configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  })

  await app.listen(port)
}

void bootstrap()
