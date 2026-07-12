import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo'
import { GraphQLModule } from '@nestjs/graphql'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { GraphqlJwtMiddleware } from './graphql-jwt.middleware'
import { schema } from './schema'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
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
          onConnect: async (ctx: { connectionParams?: Record<string, unknown> }) => {
            const authHeader = ctx.connectionParams?.Authorization as string | undefined
            if (!authHeader) return false

            const token = authHeader.startsWith('Bearer ')
              ? authHeader.slice('Bearer '.length)
              : authHeader

            const configService = new ConfigService()
            const jwtService = new JwtService({ secret: configService.get<string>('JWT_SECRET') })
            try {
              const payload = await jwtService.verifyAsync<JwtPayload>(token)
              return { user: payload }
            } catch {
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
