import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo'
import { GraphQLModule } from '@nestjs/graphql'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { GraphqlJwtMiddleware } from './graphql-jwt.middleware'
import { schema } from './schema'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { consumeWsHandshakeToken } from '../auth/ws-handshake-token.store'
import type { GraphqlContext } from './graphql-context'

type GraphqlRequest = Request & { user?: JwtPayload }

@Module({
  imports: [
    ConfigModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      schema,
      subscriptions: {
        'graphql-ws': {
          onConnect: async (ctx: {
            connectionParams?: Record<string, unknown>
            extra: unknown
          }) => {
            const authHeader = ctx.connectionParams?.Authorization as string | undefined
            if (!authHeader) return false

            const token = authHeader.startsWith('Bearer ')
              ? authHeader.slice('Bearer '.length)
              : authHeader

            const configService = new ConfigService()
            const jwtService = new JwtService({ secret: configService.get<string>('JWT_SECRET') })
            try {
              const payload = await jwtService.verifyAsync<JwtPayload>(token)
              // IMPORTANT: graphql-ws does NOT use onConnect's return value as
              // the per-operation context — it's only sent back as the
              // connection_ack payload. Values that subscription resolvers
              // need (via the `extra` param below) must be assigned onto
              // `ctx.extra` directly, since it's the same object reference
              // reused for the lifetime of this connection.
              ;(ctx.extra as { user?: JwtPayload }).user = payload
              return true
            } catch {
              // Not a real JWT — try it as a one-time WS handshake token
              // (see `/auth/ws-token` + `/api/auth/session`). This is the
              // path used after a page reload, where client JS is never
              // handed the real JWT — only a token that's valid for a few
              // seconds and exactly one use.
              const payload = consumeWsHandshakeToken(token)
              if (payload) {
                ;(ctx.extra as { user?: JwtPayload }).user = payload
                return true
              }
              return false
            }
          },
        },
      },
      context: ({
        req,
        extra,
      }: {
        req?: GraphqlRequest
        extra?: { user?: JwtPayload }
      }): GraphqlContext => ({
        user: extra?.user ?? req?.user,
        isSubscription: !!extra,
      }),
    }),
  ],
})
export class AppGraphqlModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GraphqlJwtMiddleware).forRoutes('graphql')
  }
}
