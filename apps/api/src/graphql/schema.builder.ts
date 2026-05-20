import SchemaBuilder from '@pothos/core'

import type { GraphqlContext } from './graphql-context'

export const builder = new SchemaBuilder<{ Context: GraphqlContext }>({})

builder.queryType({})
builder.mutationType({})
