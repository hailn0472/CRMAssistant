import '../contacts/contacts.graphql'
import '../users/users.graphql'
import '../roles/roles.graphql'
import '../permissions/permissions.graphql'
import '../teams/teams.graphql'
import '../sharing/sharing.graphql'
import { builder } from './schema.builder'

export const schema = builder.toSchema({})
