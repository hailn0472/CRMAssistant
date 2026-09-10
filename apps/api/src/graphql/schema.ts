// Every *.graphql module must be listed here. builder.toSchema({}) runs at
// import time over exactly this list — a module that is missing silently drops
// its fields from the SDL with no error.
import '../contacts/contacts.graphql'
import '../activities/activities.graphql'
import '../tags/tags.graphql'
import '../segments/segments.graphql'
import '../users/users.graphql'
import '../roles/roles.graphql'
import '../permissions/permissions.graphql'
import '../teams/teams.graphql'
import '../sharing/sharing.graphql'
import '../audit/audit.graphql'
import '../auth/api-key.graphql'
import '../inbox/inbox.graphql'
import '../facebook/facebook.graphql'
import '../tasks/tasks.graphql'
import '../calendar/calendar.graphql'
import '../time-tracking/time-tracking.graphql'
import '../notes/notes.graphql'
import '../notifications/notifications.graphql'
import '../dashboards/dashboards.graphql'
import { builder } from './schema.builder'

export const schema = builder.toSchema({})
