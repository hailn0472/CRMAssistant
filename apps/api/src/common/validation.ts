import { ValidationPipe } from '@nestjs/common'

/**
 * The global validation pipe used by the running application.
 *
 * Exported so integration tests can apply the exact same configuration —
 * `createNestApplication()` does not run `bootstrap()`, so without this the
 * tests would exercise an app with no DTO validation or transformation at all.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  })
}
