import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo'
import { GraphQLModule } from '@nestjs/graphql'

import { GraphqlJwtMiddleware } from './graphql-jwt.middleware'
import { schema } from './schema'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import type { GraphqlContext } from './graphql-context'

type GraphqlRequest = Request & { user?: JwtPayload }

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      schema,
      context: ({ req }: { req: GraphqlRequest }): GraphqlContext => ({ user: req.user }),
    }),
  ],
})
export class AppGraphqlModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GraphqlJwtMiddleware).forRoutes('graphql')
  }
}
