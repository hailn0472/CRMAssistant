import type { CalendarProvider } from '@prisma/client'
import type { CalendarProviderPort } from './calendar-provider.types'

/** DI token for the provider registry — a `Record<CalendarProvider, CalendarProviderPort>`. */
export const CALENDAR_PROVIDERS = Symbol('CALENDAR_PROVIDERS')

export type CalendarProviderRegistry = Record<CalendarProvider, CalendarProviderPort>
