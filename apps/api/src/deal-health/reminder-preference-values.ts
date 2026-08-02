/**
 * Fixed vocabulary for UserReminderPreference.emailFrequency (Story 3.7).
 *
 * `reason` and `emailFrequency` are String columns, not Prisma enums —
 * Deal.winLossReason set the precedent of validating a fixed vocabulary in
 * the service rather than in the DB, which avoids a migration every time the
 * vocabulary grows (story AC 11, AC 15).
 */

export const EMAIL_FREQUENCIES = ['DAILY', 'WEEKLY', 'OFF'] as const
export type EmailFrequency = (typeof EMAIL_FREQUENCIES)[number]

export const DEFAULT_EMAIL_FREQUENCY: EmailFrequency = 'DAILY'

export function isEmailFrequency(value: string): value is EmailFrequency {
  return (EMAIL_FREQUENCIES as readonly string[]).includes(value)
}
